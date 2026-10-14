import { z } from 'zod';
import { MessageEntity, NativeKey, NativeRecord, PartEntity, SessionEntity } from './entities';
import { named } from './registry';

/**
 * Atomic multi-write (plan F3). The host runs every check, then every write,
 * in one SQLite transaction. Any failed check, or an update or delete that
 * matches no row (unless `ifExists`), rolls the whole commit back and returns
 * `{ ok: false }`. The agent then throws the error it throws today.
 */

const Updates = z.record(z.string(), z.unknown());

export const CommitWrite = named('CommitWrite', z.discriminatedUnion('op', [
  z.object({ op: z.literal('session.create'), session: SessionEntity }),
  z.object({
    op: z.literal('session.update'), id: z.string(), updates: Updates,
    metadataPatch: z.record(z.string(), z.unknown()).optional()
      .describe('Shallow-merged into current metadata inside the transaction, replacing agent-side read-modify-write.'),
  }),
  z.object({ op: z.literal('message.create'), message: MessageEntity }),
  z.object({ op: z.literal('message.update'), id: z.string(), updates: Updates }),
  z.object({ op: z.literal('message.delete'), id: z.string(), ifExists: z.boolean().optional() }),
  z.object({ op: z.literal('part.create'), sessionId: z.string(), part: PartEntity }),
  z.object({ op: z.literal('part.update'), id: z.string(), updates: Updates }),
  z.object({ op: z.literal('queue.delete'), id: z.string(), ifExists: z.boolean().optional() }),
  z.object({ op: z.literal('native.put'), record: NativeRecord }),
  z.object({ op: z.literal('native.delete'), target: NativeKey, ifExists: z.boolean().optional() }),
]));
export type CommitWrite = z.infer<typeof CommitWrite>;

export const CommitCheck = named('CommitCheck', z.discriminatedUnion('check', [
  z.object({
    check: z.literal('native.equals'), target: NativeKey,
    value: z.record(z.string(), z.unknown()).describe('Every listed field must equal the stored value field.'),
  }),
  z.object({ check: z.literal('native.absent'), target: NativeKey }),
  z.object({
    check: z.literal('session.messageIds'), sessionId: z.string(),
    ids: z.array(z.string()).describe('The transcript, in order, is exactly these messages (unchanged since the agent read it).'),
  }),
  z.object({
    check: z.literal('session.harness'), sessionId: z.string(), harness: z.string()
      .describe('The session exists and is still owned by this harness.'),
  }),
  z.object({ check: z.literal('queue.present'), id: z.string().describe('A queued prompt is still waiting (not removed by the user).') }),
]));
export type CommitCheck = z.infer<typeof CommitCheck>;

export const CommitParams = z.object({
  checks: z.array(CommitCheck).default([]),
  writes: z.array(CommitWrite).min(1),
});

export const CommitResult = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    results: z.array(z.unknown()).describe('One entry per write: the stored entity for create/update, true for delete/put.'),
  }),
  z.object({
    ok: z.literal(false),
    failed: z.object({
      kind: z.enum(['check', 'write']), index: z.number().int().nonnegative(),
      message: z.string().optional().describe('Why a write failed (constraint, missing row); for logs only.'),
    }),
  }),
]);
