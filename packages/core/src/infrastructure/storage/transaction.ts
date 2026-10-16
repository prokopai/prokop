import type { CommitCheck, CommitResult, CommitWrite, NativeKey, NativeRecord, StorageBundle } from './contracts';
import { getStorage } from './runtime';

/**
 * Optimistic transactions over `StorageBundle.commit` (plan F3). `build`
 * reads through the bundle, then queues checks and writes; the bundle applies
 * them atomically. When a retryable check fails (someone changed what was
 * read), `build` runs again from fresh reads. Harnesses use this instead of
 * SQLite transactions, so they depend only on the storage bundle.
 */

export interface StoreRef<T> {
  /** The stored entity (create/update) or `true` (delete/put); readable once the commit succeeded. */
  readonly value: T;
}

export class StoreCommitError extends Error {
  constructor(message: string, readonly failed?: Extract<CommitResult, { ok: false }>['failed']) {
    super(message);
    this.name = 'StoreCommitError';
  }
}

export interface StoreTransaction {
  readonly storage: StorageBundle;
  /** A guard. On failure `build` re-runs, or with `error` the transaction throws it. */
  check(check: CommitCheck, error?: Error): void;
  write<T = unknown>(write: CommitWrite): StoreRef<T>;
}

const ATTEMPTS = 5;

export async function storeTransaction<R>(
  build: (tx: StoreTransaction) => R | Promise<R>,
  options: { storage?: StorageBundle } = {},
): Promise<R> {
  const storage = options.storage ?? getStorage();
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const checks: Array<{ check: CommitCheck; error?: Error }> = [];
    const writes: CommitWrite[] = [];
    const results: unknown[] = [];
    let committed = false;
    const tx: StoreTransaction = {
      storage,
      check: (check, error) => { checks.push({ check, error }); },
      write: <T>(write: CommitWrite): StoreRef<T> => {
        const index = writes.push(write) - 1;
        return {
          get value(): T {
            if (!committed) throw new Error('Store write read before its commit');
            return results[index] as T;
          },
        };
      },
    };
    const value = await build(tx);
    if (!writes.length) return value;
    const result = await storage.commit({ checks: checks.map(entry => entry.check), writes });
    if (result.ok) {
      results.push(...result.results);
      committed = true;
      return value;
    }
    if (result.failed.kind === 'write') {
      throw new StoreCommitError(result.failed.message ?? 'Store write failed', result.failed);
    }
    const error = checks[result.failed.index]?.error;
    if (error) throw error;
  }
  throw new StoreCommitError('Store commit kept conflicting with concurrent writes');
}

/** Runs `build` inside `tx` when given, else in its own transaction. */
export function withinTransaction<R>(
  tx: StoreTransaction | undefined,
  build: (tx: StoreTransaction) => R | Promise<R>,
): Promise<R> {
  return tx ? Promise.resolve(build(tx)) : storeTransaction(build);
}

/**
 * Reads a native record, lets `change` decide, and queues the write guarded
 * by the value read. `change` returns the next record, `null` to delete, or
 * `undefined` to leave it (the result is then false).
 */
export async function updateNative<V>(
  tx: StoreTransaction,
  target: NativeKey,
  change: (current: NativeRecord<V> | null) => NativeRecord<V> | null | undefined,
): Promise<boolean> {
  const current = await tx.storage.native.get<V>(target);
  const next = change(current);
  if (next === undefined || (next === null && !current)) return false;
  tx.check(current
    ? { check: 'native.equals', target, value: current.value as Record<string, unknown> }
    : { check: 'native.absent', target });
  tx.write(next === null ? { op: 'native.delete', target } : { op: 'native.put', record: next });
  return true;
}

/** Queues an insert; the commit fails when the key (or the lookup) already exists. */
export function insertNative(tx: StoreTransaction, record: NativeRecord, error?: Error): void {
  const target = { harness: record.harness, kind: record.kind, key: record.key };
  tx.check({ check: 'native.absent', target }, error ?? new StoreCommitError('Native record already exists'));
  tx.write({ op: 'native.put', record });
}
