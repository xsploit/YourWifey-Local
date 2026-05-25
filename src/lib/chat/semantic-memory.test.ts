import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PERSONA } from './defaults';
import {
  addSemanticMemoryTurn,
  buildSemanticMemoryContext,
  findSemanticMemoryMatchesInRecords,
  loadSemanticMemory,
  saveSemanticMemory,
  scoreSemanticMemoryRecord,
  type SemanticMemoryRecord,
} from './semantic-memory';

function createStorage() {
  const values = new Map<string, string>();
  return {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

function createRecord(overrides: Partial<SemanticMemoryRecord> = {}): SemanticMemoryRecord {
  return {
    assistantText: overrides.assistantText ?? 'Got it.',
    createdAt: overrides.createdAt ?? Date.parse('2026-05-14T08:00:00.000Z'),
    embedding: overrides.embedding ?? null,
    id: overrides.id ?? 'record-1',
    personaId: overrides.personaId ?? DEFAULT_PERSONA.id,
    scopeKey: overrides.scopeKey ?? 'local:persona:neuro-sama',
    text: overrides.text ?? 'User: remember I like vector memory\nNeuro-sama: Got it.',
    userText: overrides.userText ?? 'remember I like vector memory',
  };
}

describe('semantic memory', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      localStorage: createStorage(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stores embedded memories through the fallback browser store', async () => {
    const scopeKey = 'twitch:subsect:persona:neuro-sama';

    await addSemanticMemoryTurn({
      assistantText: 'Fine, I will remember your excellent taste.',
      embedding: [1, 0, 0],
      persona: DEFAULT_PERSONA,
      scopeKey,
      userText: 'remember I like vector memory',
    });

    const records = await loadSemanticMemory(scopeKey);

    expect(records).toHaveLength(1);
    expect(records[0]?.scopeKey).toBe(scopeKey);
    expect(records[0]?.embedding).toEqual([1, 0, 0]);
    expect(records[0]?.text).toContain('vector memory');
  });

  it('clears semantic memories for a scope when saved empty', async () => {
    const scopeKey = 'local:persona:hikari-chan';

    await addSemanticMemoryTurn({
      assistantText: 'Saved.',
      embedding: [1, 0, 0],
      persona: DEFAULT_PERSONA,
      scopeKey,
      userText: 'remember my favorite stage is chroma',
    });
    await saveSemanticMemory(scopeKey, []);

    expect(await loadSemanticMemory(scopeKey)).toEqual([]);
  });

  it('ranks local vector matches above unrelated lexical records', () => {
    const records = [
      createRecord({
        embedding: [1, 0],
        id: 'vector-hit',
        text: 'User: remember my favorite TTS voice is Hikari raspy\nNeuro-sama: filed.',
      }),
      createRecord({
        embedding: [0, 1],
        id: 'lexical-noise',
        text: 'User: memory memory memory unrelated queue topic\nNeuro-sama: okay.',
      }),
    ];

    const matches = findSemanticMemoryMatchesInRecords(records, 'which voice do I like?', [1, 0]);

    expect(matches[0]?.id).toBe('vector-hit');
    expect(matches[0]?.score).toBeGreaterThan(matches[1]?.score ?? 0);
  });

  it('falls back to lexical/recency scoring when embeddings are unavailable', () => {
    const record = createRecord({
      embedding: null,
      text: 'User: remember I prefer local chat controls\nNeuro-sama: saved.',
    });

    const score = scoreSemanticMemoryRecord(record, 'local chat controls', null);

    expect(score).toBeGreaterThan(0.05);
    expect(buildSemanticMemoryContext([{ ...record, score }])).toContain('local chat controls');
  });
});
