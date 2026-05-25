import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import type lbug from '@ladybugdb/core';

type LadybugModule = typeof lbug;
type LadybugConnection = InstanceType<LadybugModule['Connection']>;
type LadybugDatabase = InstanceType<LadybugModule['Database']>;

export type LadybugSemanticMemoryRecord = {
  assistantText: string;
  createdAt: number;
  embedding: number[] | null;
  id: string;
  personaId: string;
  scopeKey: string;
  text: string;
  userText: string;
};

export type LadybugSemanticMemoryMatch = LadybugSemanticMemoryRecord & {
  score: number;
};

export type LadybugMemoryStatus = {
  available: boolean;
  databasePath: string;
  error: string | null;
  grilloScopes: number;
  relationshipScopes: number;
  semanticRecords: number;
  vectorRecords: number;
};

const DEFAULT_DB_PATH = '.webwaifu4/ladybug-memory.lbug';

function cypherString(value: string) {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function cypherNumber(value: number) {
  return Number.isFinite(value) ? String(value) : '0';
}

function cypherVector(values: number[]) {
  return `[${values.map((value) => cypherNumber(value)).join(', ')}]`;
}

function safeJsonParse<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeRows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => normalizeRows(entry));
  }
  const result = value as { getAll?: () => Promise<Record<string, unknown>[]>; close?: () => void };
  if (!result?.getAll) {
    return [];
  }
  throw new Error('normalizeRows must be called through queryRows.');
}

function normalizeSemanticRecord(value: unknown): LadybugSemanticMemoryRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const source = value as Partial<LadybugSemanticMemoryRecord>;
  if (
    typeof source.id !== 'string' ||
    typeof source.scopeKey !== 'string' ||
    typeof source.text !== 'string'
  ) {
    return null;
  }
  return {
    assistantText: typeof source.assistantText === 'string' ? source.assistantText : '',
    createdAt: Number.isFinite(source.createdAt) ? Number(source.createdAt) : Date.now(),
    embedding: Array.isArray(source.embedding)
      ? source.embedding.filter((item): item is number => Number.isFinite(item))
      : null,
    id: source.id,
    personaId: typeof source.personaId === 'string' ? source.personaId : '',
    scopeKey: source.scopeKey,
    text: source.text,
    userText: typeof source.userText === 'string' ? source.userText : '',
  };
}

export class LadybugMemoryService {
  private connection: LadybugConnection | null = null;
  private database: LadybugDatabase | null = null;
  private initPromise: Promise<void> | null = null;
  private lastError: string | null = null;
  private vectorExtensionLoaded = false;
  private vectorIndexes = new Set<number>();

  constructor(private readonly databasePath = process.env.WEBWAIFU4_LADYBUG_PATH || DEFAULT_DB_PATH) {}

  get resolvedDatabasePath() {
    return resolve(this.databasePath);
  }

  async close() {
    await this.connection?.close().catch(() => undefined);
    await this.database?.close().catch(() => undefined);
    this.connection = null;
    this.database = null;
    this.initPromise = null;
  }

  async available() {
    try {
      await this.ensureReady();
      return true;
    } catch {
      return false;
    }
  }

  async status(): Promise<LadybugMemoryStatus> {
    try {
      await this.ensureReady();
      const [semanticRecords, vectorRecords, grilloScopes, relationshipScopes] = await Promise.all([
        this.countTable('SemanticMemory'),
        this.countTable('SemanticVector'),
        this.countTable('GrilloMemory'),
        this.countTable('RelationshipMemory'),
      ]);
      return {
        available: true,
        databasePath: this.resolvedDatabasePath,
        error: null,
        grilloScopes,
        relationshipScopes,
        semanticRecords,
        vectorRecords,
      };
    } catch (error) {
      return {
        available: false,
        databasePath: this.resolvedDatabasePath,
        error: error instanceof Error ? error.message : 'Ladybug memory unavailable.',
        grilloScopes: 0,
        relationshipScopes: 0,
        semanticRecords: 0,
        vectorRecords: 0,
      };
    }
  }

  async loadSemanticMemory(scopeKey: string) {
    await this.ensureReady();
    const rows = await this.queryRows(`
      MATCH (m:SemanticMemory {scopeKey: ${cypherString(scopeKey)}})
      RETURN m.bodyJson AS bodyJson
      ORDER BY m.createdAt DESC;
    `);
    return rows
      .map((row) => normalizeSemanticRecord(safeJsonParse(row.bodyJson, null)))
      .filter((record): record is LadybugSemanticMemoryRecord => Boolean(record));
  }

  async saveSemanticMemory(scopeKey: string, records: LadybugSemanticMemoryRecord[]) {
    await this.ensureReady();
    const dimensions = await this.getSemanticDimensions(scopeKey);
    await this.ensureScope(scopeKey);
    await this.runIgnoringMissing(`
      MATCH (:MemoryScope {scopeKey: ${cypherString(scopeKey)}})-[r:HAS_SEMANTIC]->(:SemanticMemory)
      DELETE r;
    `);
    await this.runIgnoringMissing(
      `MATCH (m:SemanticMemory {scopeKey: ${cypherString(scopeKey)}}) DELETE m;`,
    );
    await this.runIgnoringMissing(
      `MATCH (v:SemanticVector {scopeKey: ${cypherString(scopeKey)}}) DELETE v;`,
    );
    for (const dimension of dimensions) {
      await this.runIgnoringMissing(
        `MATCH (v:${this.vectorTableName(dimension)} {scopeKey: ${cypherString(scopeKey)}}) DELETE v;`,
      );
    }

    for (const rawRecord of records) {
      const record = normalizeSemanticRecord({ ...rawRecord, scopeKey });
      if (!record) {
        continue;
      }
      await this.query(`
        CREATE (m:SemanticMemory {
          id: ${cypherString(record.id)},
          scopeKey: ${cypherString(scopeKey)},
          personaId: ${cypherString(record.personaId)},
          text: ${cypherString(record.text)},
          userText: ${cypherString(record.userText)},
          assistantText: ${cypherString(record.assistantText)},
          createdAt: ${cypherNumber(record.createdAt)},
          bodyJson: ${cypherString(JSON.stringify(record))},
          embeddingJson: ${cypherString(JSON.stringify(record.embedding ?? []))},
          dimension: ${cypherNumber(record.embedding?.length ?? 0)}
        });
        MATCH (s:MemoryScope {scopeKey: ${cypherString(scopeKey)}})
        MATCH (m:SemanticMemory {id: ${cypherString(record.id)}})
        CREATE (s)-[:HAS_SEMANTIC]->(m);
      `);
      if (record.embedding?.length) {
        await this.saveSemanticVector(scopeKey, record);
      }
    }
  }

  async searchSemanticMemory(scopeKey: string, embedding: number[], limit: number) {
    await this.ensureReady();
    if (!embedding.length) {
      return [];
    }
    const dimension = embedding.length;
    await this.ensureVectorIndex(dimension).catch(() => undefined);
    if (!this.vectorIndexes.has(dimension)) {
      return [];
    }
    const rows = await this.queryRows(`
      CALL QUERY_VECTOR_INDEX(
        ${cypherString(this.vectorTableName(dimension))},
        ${cypherString(this.vectorIndexName(dimension))},
        ${cypherVector(embedding)},
        ${cypherNumber(Math.max(1, Math.min(20, Math.round(limit))))}
      )
      RETURN node.id AS id, distance
      ORDER BY distance;
    `);
    const ids = rows
      .map((row) => (typeof row.id === 'string' ? row.id : ''))
      .filter(Boolean);
    if (ids.length === 0) {
      return [];
    }
    const records = await this.loadSemanticMemory(scopeKey);
    const byId = new Map(records.map((record) => [record.id, record]));
    return rows
      .map((row) => {
        const id = typeof row.id === 'string' ? row.id : '';
        const record = byId.get(id);
        if (!record) {
          return null;
        }
        const distance = typeof row.distance === 'number' ? row.distance : Number(row.distance ?? 1);
        return {
          ...record,
          score: Math.max(0, 1 - distance),
        };
      })
      .filter((record): record is LadybugSemanticMemoryMatch => Boolean(record));
  }

  async loadGrilloMemory(scopeKey: string) {
    return this.loadJsonByScope('GrilloMemory', scopeKey);
  }

  async saveGrilloMemory(scopeKey: string, state: unknown) {
    await this.saveJsonByScope('GrilloMemory', 'HAS_GRILLO', scopeKey, state);
  }

  async loadRelationshipMemory(scopeKey: string) {
    return this.loadJsonByScope('RelationshipMemory', scopeKey);
  }

  async saveRelationshipMemory(scopeKey: string, state: unknown) {
    await this.saveJsonByScope('RelationshipMemory', 'HAS_RELATIONSHIP', scopeKey, state);
  }

  private async saveSemanticVector(scopeKey: string, record: LadybugSemanticMemoryRecord) {
    const embedding = record.embedding;
    if (!embedding?.length) {
      return;
    }
    const dimension = embedding.length;
    await this.ensureSemanticVectorTable(dimension);
    await this.query(`
      CREATE (v:SemanticVector {
        id: ${cypherString(record.id)},
        scopeKey: ${cypherString(scopeKey)},
        semanticId: ${cypherString(record.id)},
        dimension: ${cypherNumber(dimension)}
      });
      CREATE (vd:${this.vectorTableName(dimension)} {
        id: ${cypherString(record.id)},
        scopeKey: ${cypherString(scopeKey)},
        embedding: ${cypherVector(embedding)}
      });
    `);
    await this.ensureVectorIndex(dimension).catch(() => undefined);
  }

  private async loadJsonByScope(tableName: 'GrilloMemory' | 'RelationshipMemory', scopeKey: string) {
    await this.ensureReady();
    const rows = await this.queryRows(`
      MATCH (m:${tableName} {scopeKey: ${cypherString(scopeKey)}})
      RETURN m.bodyJson AS bodyJson
      LIMIT 1;
    `);
    return safeJsonParse(rows[0]?.bodyJson, null);
  }

  private async saveJsonByScope(
    tableName: 'GrilloMemory' | 'RelationshipMemory',
    relName: 'HAS_GRILLO' | 'HAS_RELATIONSHIP',
    scopeKey: string,
    state: unknown,
  ) {
    await this.ensureReady();
    await this.ensureScope(scopeKey);
    await this.runIgnoringMissing(`
      MATCH (:MemoryScope {scopeKey: ${cypherString(scopeKey)}})-[r:${relName}]->(:${tableName})
      DELETE r;
    `);
    await this.runIgnoringMissing(`MATCH (m:${tableName} {scopeKey: ${cypherString(scopeKey)}}) DELETE m;`);
    await this.query(`
      CREATE (m:${tableName} {
        scopeKey: ${cypherString(scopeKey)},
        bodyJson: ${cypherString(JSON.stringify(state ?? null))},
        updatedAt: ${Date.now()}
      });
      MATCH (s:MemoryScope {scopeKey: ${cypherString(scopeKey)}})
      MATCH (m:${tableName} {scopeKey: ${cypherString(scopeKey)}})
      CREATE (s)-[:${relName}]->(m);
    `);
  }

  private async ensureReady() {
    if (!this.initPromise) {
      this.initPromise = this.init();
    }
    await this.initPromise;
  }

  private async init() {
    try {
      const imported = (await import('@ladybugdb/core')) as { default?: LadybugModule } & LadybugModule;
      const lbug = imported.default ?? imported;
      await mkdir(dirname(this.resolvedDatabasePath), { recursive: true });
      this.database = new lbug.Database(this.resolvedDatabasePath);
      this.connection = new lbug.Connection(this.database);
      await this.connection.init();
      await this.ensureSchema();
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Ladybug memory init failed.';
      this.connection = null;
      this.database = null;
      this.initPromise = null;
      throw error;
    }
  }

  private async ensureSchema() {
    await this.runIgnoringExists(
      'CREATE NODE TABLE MemoryScope(scopeKey STRING PRIMARY KEY, updatedAt INT64);',
    );
    await this.runIgnoringExists(`
      CREATE NODE TABLE SemanticMemory(
        id STRING PRIMARY KEY,
        scopeKey STRING,
        personaId STRING,
        text STRING,
        userText STRING,
        assistantText STRING,
        createdAt INT64,
        bodyJson STRING,
        embeddingJson STRING,
        dimension INT64
      );
    `);
    await this.runIgnoringExists(
      'CREATE NODE TABLE SemanticVector(id STRING PRIMARY KEY, scopeKey STRING, semanticId STRING, dimension INT64);',
    );
    await this.runIgnoringExists(
      'CREATE NODE TABLE GrilloMemory(scopeKey STRING PRIMARY KEY, bodyJson STRING, updatedAt INT64);',
    );
    await this.runIgnoringExists(
      'CREATE NODE TABLE RelationshipMemory(scopeKey STRING PRIMARY KEY, bodyJson STRING, updatedAt INT64);',
    );
    await this.runIgnoringExists(
      'CREATE REL TABLE HAS_SEMANTIC(FROM MemoryScope TO SemanticMemory);',
    );
    await this.runIgnoringExists('CREATE REL TABLE HAS_GRILLO(FROM MemoryScope TO GrilloMemory);');
    await this.runIgnoringExists(
      'CREATE REL TABLE HAS_RELATIONSHIP(FROM MemoryScope TO RelationshipMemory);',
    );
  }

  private async ensureScope(scopeKey: string) {
    await this.query(`
      MERGE (s:MemoryScope {scopeKey: ${cypherString(scopeKey)}})
      SET s.updatedAt = ${Date.now()};
    `);
  }

  private async ensureVectorExtension() {
    if (this.vectorExtensionLoaded) {
      return;
    }
    await this.query('INSTALL vector; LOAD vector;');
    this.vectorExtensionLoaded = true;
  }

  private async ensureSemanticVectorTable(dimension: number) {
    await this.runIgnoringExists(
      `CREATE NODE TABLE ${this.vectorTableName(dimension)}(id STRING PRIMARY KEY, scopeKey STRING, embedding FLOAT[${dimension}]);`,
    );
  }

  private async ensureVectorIndex(dimension: number) {
    if (this.vectorIndexes.has(dimension)) {
      return;
    }
    await this.ensureVectorExtension();
    await this.ensureSemanticVectorTable(dimension);
    await this.query(`
      CALL CREATE_VECTOR_INDEX(
        ${cypherString(this.vectorTableName(dimension))},
        ${cypherString(this.vectorIndexName(dimension))},
        'embedding',
        metric := 'cosine'
      );
    `).catch(async (error) => {
      if (!this.isExistsError(error)) {
        throw error;
      }
    });
    this.vectorIndexes.add(dimension);
  }

  private async getSemanticDimensions(scopeKey: string) {
    const rows = await this.queryRows(`
      MATCH (v:SemanticVector {scopeKey: ${cypherString(scopeKey)}})
      RETURN DISTINCT v.dimension AS dimension;
    `).catch(() => []);
    return rows
      .map((row) => Number(row.dimension))
      .filter((dimension) => Number.isInteger(dimension) && dimension > 0 && dimension < 10000);
  }

  private vectorTableName(dimension: number) {
    return `SemanticVectorDim${dimension}`;
  }

  private vectorIndexName(dimension: number) {
    return `semantic_vector_idx_${dimension}`;
  }

  private async countTable(tableName: string) {
    const rows = await this.queryRows(`MATCH (n:${tableName}) RETURN count(n) AS count;`).catch(() => []);
    return Number(rows[0]?.count ?? 0);
  }

  private async queryRows(statement: string) {
    const result = await this.query(statement);
    const results = Array.isArray(result) ? result : [result];
    const rows: Record<string, unknown>[] = [];
    for (const item of results) {
      rows.push(...(await item.getAll()));
      item.close?.();
    }
    return rows;
  }

  private async query(statement: string) {
    if (!this.connection) {
      throw new Error(this.lastError ?? 'Ladybug memory connection is not ready.');
    }
    return await this.connection.query(statement);
  }

  private async runIgnoringExists(statement: string) {
    try {
      await this.query(statement);
    } catch (error) {
      if (!this.isExistsError(error)) {
        throw error;
      }
    }
  }

  private async runIgnoringMissing(statement: string) {
    try {
      await this.query(statement);
    } catch (error) {
      if (!this.isMissingError(error)) {
        throw error;
      }
    }
  }

  private isExistsError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return /already exists|duplicated|duplicate/i.test(message);
  }

  private isMissingError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return /does not exist|not found|cannot find|Catalog exception/i.test(message);
  }
}

export const ladybugMemoryService = new LadybugMemoryService();
