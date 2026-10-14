import { describe, expect, test } from 'bun:test';
import type { StorageBundle } from '@prokopai/core/infrastructure/storage/contracts';
import { createInMemoryStorageBundle } from '@prokopai/core/infrastructure/storage/memory';
import { insertNative, storeTransaction, StoreCommitError, updateNative } from '@prokopai/core/infrastructure/storage/transaction';
import { createTestSession } from '#tests/factories';

const target = { harness: 'codex-cli' as const, kind: 'binding', key: 's1' };

async function bundle(): Promise<StorageBundle> {
  const storage = createInMemoryStorageBundle();
  const { createdAt: _c, updatedAt: _u, ...session } = createTestSession({ id: 's1', workspaceId: 'w1' });
  await storage.conversation.createSession(session);
  await storage.commit({ writes: [{ op: 'native.put', record: { ...target, sessionId: 's1', blocksSwitch: false,
    value: { count: 0 } } }] });
  return storage;
}

describe('storeTransaction', () => {
  test('re-runs from fresh reads when a guarded value changed before the commit', async () => {
    const storage = await bundle();
    let runs = 0;
    await storeTransaction(async (tx) => {
      runs++;
      await updateNative<{ count: number }>(tx, target, current => current
        ? { ...current, value: { count: current.value.count + 1 } } : undefined);
      // A concurrent writer lands between this read and the commit, once.
      if (runs === 1) await storage.commit({ writes: [{ op: 'native.put', record: { ...target, sessionId: 's1',
        blocksSwitch: false, value: { count: 10 } } }] });
    }, { storage });
    expect(runs).toBe(2);
    expect((await storage.native.get(target))?.value).toEqual({ count: 11 });
  });

  test('a check with its own error throws it instead of retrying', async () => {
    const storage = await bundle();
    let runs = 0;
    const attempt = storeTransaction((tx) => {
      runs++;
      insertNative(tx, { ...target, sessionId: 's1', blocksSwitch: false, value: {} }, new Error('Already bound'));
    }, { storage });
    await expect(attempt).rejects.toThrow('Already bound');
    expect(runs).toBe(1);
  });

  test('write results are readable after the commit; a failed write throws with its reason', async () => {
    const storage = await bundle();
    const updated = await storeTransaction(tx => tx.write<{ title: string }>(
      { op: 'session.update', id: 's1', updates: { title: 'New' } }), { storage });
    expect(updated.value.title).toBe('New');
    const failing = storeTransaction(tx => { tx.write({ op: 'message.update', id: 'missing', updates: {} }); }, { storage });
    await expect(failing).rejects.toBeInstanceOf(StoreCommitError);
  });

  test('a transaction without writes commits nothing and returns its value', async () => {
    const storage = await bundle();
    expect(await storeTransaction(async tx => (await tx.storage.native.get(target))?.value, { storage }))
      .toEqual({ count: 0 });
  });
});
