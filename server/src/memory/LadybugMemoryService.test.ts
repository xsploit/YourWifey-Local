import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LadybugMemoryService, type LadybugSemanticMemoryRecord } from './LadybugMemoryService';

describe('LadybugMemoryService', () => {
  let dir = '';
  let service: LadybugMemoryService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'webwaifu4-ladybug-'));
    service = new LadybugMemoryService(join(dir, 'memory.lbug'));
  });

  afterEach(async () => {
    await service.close();
    await rm(dir, { force: true, recursive: true });
  });

  it('persists semantic records and searches with native vectors', async () => {
    const scopeKey = 'local:persona:hikari-chan';
    const records: LadybugSemanticMemoryRecord[] = [
      {
        assistantText: 'Saved.',
        createdAt: 1,
        embedding: [1, 0, 0],
        id: 'voice-memory',
        personaId: 'hikari-chan',
        scopeKey,
        text: 'User likes raspy Fish voice presets.',
        userText: 'remember I like raspy Fish voice',
      },
      {
        assistantText: 'Saved.',
        createdAt: 2,
        embedding: [0, 1, 0],
        id: 'stage-memory',
        personaId: 'hikari-chan',
        scopeKey,
        text: 'User prefers chroma key desktop mode.',
        userText: 'remember chroma key desktop mode',
      },
    ];

    await service.saveSemanticMemory(scopeKey, records);

    expect(await service.loadSemanticMemory(scopeKey)).toHaveLength(2);
    const matches = await service.searchSemanticMemory(scopeKey, [1, 0, 0], 2);

    expect(matches[0]?.id).toBe('voice-memory');
    expect(matches[0]?.score).toBeGreaterThan(0.95);
    expect((await service.status()).vectorRecords).toBe(2);
  });

  it('persists Grillo and relationship snapshots under the memory scope graph', async () => {
    const scopeKey = 'twitch:subsect:persona:hikari-chan';
    const grillo = {
      blocks: [{ blockId: 'b1', items: ['likes local-first releases'] }],
      scopeKey,
    };
    const relationship = {
      facts: ['subsect wants Twitch and local chat memory together'],
      mood: 'focused',
      relationshipStage: 'familiar',
    };

    await service.saveGrilloMemory(scopeKey, grillo);
    await service.saveRelationshipMemory(scopeKey, relationship);

    expect(await service.loadGrilloMemory(scopeKey)).toEqual(grillo);
    expect(await service.loadRelationshipMemory(scopeKey)).toEqual(relationship);
    await expect(service.status()).resolves.toMatchObject({
      available: true,
      grilloScopes: 1,
      relationshipScopes: 1,
    });
  });
});
