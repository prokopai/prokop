import { describe, expect, test } from 'bun:test';
import { createInMemoryStorageBundle } from '@prokopai/core/infrastructure/storage/memory';
import { getSession, updateSession, withStorage } from '@prokopai/core/infrastructure/storage/runtime';
import { patchSessionMetadata } from './session-metadata';

function seededStorage() {
  const storage = createInMemoryStorageBundle();
  return withStorage(storage, async () => {
    await storage.conversation.createSession({
      id: 's1', workspaceId: 'w1', preconfigId: null, title: 's1', status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      metadata: { kept: 1 }, parentId: null, agentName: null,
    });
    return storage;
  });
}

describe('patchSessionMetadata', () => {
  test('keeps keys another writer set after the caller last read the session', async () => {
    const storage = await seededStorage();
    await withStorage(storage, async () => {
      const stale = await getSession('s1');
      await updateSession('s1', { metadata: { ...(stale?.metadata ?? {}), concurrent: true } });

      const updated = await patchSessionMetadata('s1', { claudeContext: { used: 10 } });

      expect(updated?.metadata).toEqual({ kept: 1, concurrent: true, claudeContext: { used: 10 } });
    });
  });

  test('applies session updates in the same write and returns null for a missing session', async () => {
    const storage = await seededStorage();
    await withStorage(storage, async () => {
      const updated = await patchSessionMetadata('s1', { claudeUsage: { last: 1 } }, { promptTokens: 5 });
      expect(updated?.promptTokens).toBe(5);
      expect(updated?.metadata).toEqual({ kept: 1, claudeUsage: { last: 1 } });
      expect(await patchSessionMetadata('missing', { x: 1 })).toBeNull();
    });
  });
});
