import { z } from 'zod';
import {
  PreconfigEntity, SessionEntity, SessionHarness, WorkspaceEntity,
} from './entities';
import { Ack, named, requests } from './registry';

/**
 * Opaque handle for the WebSocket connection that started an operation.
 * The host maps it back to its connection for `deliver` with
 * `audience.scope = 'origin'`; null for host-started work (queue drain,
 * scheduler).
 */
export const OriginToken = named('OriginToken', z.string().nullable());

/** Data the agent previously pulled through sync host bindings (plan F5). */
export const TurnSnapshot = named('TurnSnapshot', z.object({
  session: SessionEntity,
  workspace: WorkspaceEntity,
  root: z.object({
    path: z.string().optional().describe('Resolved session root (managed worktree or workspace path).'),
    additionalPaths: z.array(z.string()),
    allowedRoots: z.array(z.string()).describe('Read-only roots: uploads and the agent directory.'),
    tempDir: z.string(),
  }),
  responseFormat: z.record(z.string(), z.unknown()).nullable().optional(),
}));

const Goal = z.object({
  condition: z.string(),
  maxTurns: z.number().int().positive().optional(),
  tokenBudget: z.number().int().positive().optional(),
});

const InterruptResult = z.object({
  sessionId: z.string(),
  success: z.boolean(),
  cascadedTo: z.array(z.string()),
  interruptedTools: z.array(z.string()),
  rejectedAsks: z.array(z.string()),
});

const CompactionOutcome = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), result: z.object({ tokensUsed: z.object({ prompt: z.number(), completion: z.number() }) }) }),
  z.object({ ok: z.literal(false), error: z.string(), skipped: z.boolean().optional() }),
]);

const RevertResult = z.object({
  revertedTo: z.object({ messageId: z.string().nullable(), messageCount: z.number().int() }),
  removed: z.object({ messageIds: z.array(z.string()), partCount: z.number().int() }),
});

const HarnessParams = named('HarnessParams', z.object({ harness: SessionHarness }));

export const hostToAgentRequests = requests({
  initialize: {
    description: 'First request after spawn. The host passes settings the agent used to read synchronously.',
    params: z.object({
      protocolVersion: z.number().int(),
      host: z.object({ version: z.string() }),
      settings: z.object({ sandboxActive: z.boolean(), permissionTimeoutMs: z.number().int().positive() }),
    }),
    result: z.object({
      protocolVersion: z.number().int(),
      agent: z.object({ version: z.string() }),
      harnesses: z.array(SessionHarness),
    }),
  },
  'turn.start': {
    description: 'SessionExecutionPort.sendMessage. Resolves when the turn ends. A queued prompt carries queueId; the agent retires that row in the same store.commit that writes the user message.',
    params: z.object({
      origin: OriginToken,
      sessionId: z.string(),
      content: z.string(),
      attachments: z.array(z.object({ id: z.string(), kind: z.string() })).optional(),
      responseFormatId: z.string().optional(),
      goal: Goal.optional(),
      queueId: z.string().optional(),
      snapshot: TurnSnapshot,
    }),
    result: z.object({
      outcome: z.enum(['completed', 'rejected', 'drainable'])
        .describe('drainable: the host may start the next queued prompt.'),
    }),
  },
  'turn.edit': {
    description: 'SessionExecutionPort.editMessage.',
    params: z.object({ origin: OriginToken, sessionId: z.string(), messageId: z.string(), content: z.string(), snapshot: TurnSnapshot }),
    result: Ack,
  },
  'turn.steer': {
    description: 'SessionExecutionPort.steerQueue: deliver waiting steer messages into the running turn.',
    params: z.object({ origin: OriginToken, sessionId: z.string() }),
    result: Ack,
  },
  'turn.interrupt': {
    description: 'SessionExecutionPort.interruptSession, including child sessions.',
    params: z.object({ sessionId: z.string(), reason: z.string().optional() }),
    result: InterruptResult,
  },
  'turn.headless': {
    description: 'HeadlessSessionRunPort.run (scheduled jobs, learning reviews). Prokop only today.',
    params: z.object({
      harness: SessionHarness,
      parentSessionId: z.string(),
      childSessionId: z.string(),
      preconfig: PreconfigEntity,
      prompt: z.string(),
      workspacePath: z.string().optional(),
      workspaceId: z.string(),
      modelId: z.string(),
      providerId: z.string(),
      resumeFromHistory: z.boolean(),
    }),
    result: z.object({ error: z.string().optional() }),
  },
  compact: {
    description: 'SessionExecutionPort.compact (manual). Auto-compaction runs inside turns.',
    params: z.object({ sessionId: z.string(), reason: z.literal('manual') }),
    result: CompactionOutcome,
  },
  revert: {
    description: 'SessionExecutionPort.revert. Claude/Codex also roll back their native thread.',
    params: z.object({ sessionId: z.string(), targetMessageId: z.string() }),
    result: RevertResult,
  },
  fork: {
    description: 'SessionExecutionPort.fork. Claude/Codex also fork their native thread.',
    params: z.object({ sessionId: z.string(), targetMessageId: z.string(), title: z.string().optional() }),
    result: z.object({ forkedSession: SessionEntity, messages: z.array(z.unknown()) }),
  },
  'title.generate': {
    description: 'SessionExecutionPort.regenerateTitle (LLM call in the agent).',
    params: z.object({ origin: OriginToken, sessionId: z.string(), force: z.boolean().optional() }),
    result: Ack,
  },
  'title.native': {
    description: 'Title the CLI wrote itself (readClaudeSessionTitle).',
    params: z.object({ sessionId: z.string() }),
    result: z.object({ title: z.string().nullable() }),
  },
  'ask.resolve': {
    description: 'The user answered a pending ask. Replaces the three in-process resolution ports (decision 6 A).',
    params: z.object({
      sessionId: z.string(),
      toolCallId: z.string(),
      requestId: z.string().optional(),
      response: z.unknown(),
    }),
    result: z.object({ resolved: z.boolean() }),
  },
  'harness.status': {
    description: 'CLI availability and version probe (codexCliAvailable, claudeCliVersion, ...).',
    params: HarnessParams,
    result: z.object({ available: z.boolean(), version: z.string().nullable() }),
  },
  'models.list': {
    description: 'Cached model catalog of a CLI harness.',
    params: HarnessParams,
    result: z.object({ models: z.array(z.record(z.string(), z.unknown())) }),
  },
  'usage.limits': {
    description: 'Cached plan usage limits of a CLI harness.',
    params: HarnessParams,
    result: z.record(z.string(), z.unknown()),
  },
  shutdown: {
    description: 'Finish cleanup (close Codex app-server connections) and exit. Sent only with no active turns.',
    params: z.object({}),
    result: Ack,
  },
});
