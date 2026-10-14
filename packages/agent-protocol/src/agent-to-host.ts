import { z } from 'zod';
import { CommitParams, CommitResult } from './commit';
import {
  AttachmentRecord, EffectiveContextHistory, MessageEntity, MessageWithPartsEntity, NativeKey,
  NativeRecord, PartEntity, PendingAskRecord, PermissionGrantEntity,
  QueuedMessageEntity, ResponseFormatEntity, SessionEntity, StreamingPartSnapshot, ToolOutputArtifact,
  ToolOutputArtifactFormat, ToolOutputArtifactPage, ToolPartEntity, TranscriptPage, WorkspaceEntity,
} from './entities';
import { Ack, named, requests } from './registry';

const Id = named('IdParams', z.object({ id: z.string() }));
const SessionIdParams = named('SessionIdParams', z.object({ sessionId: z.string() }));
const Updates = z.record(z.string(), z.unknown());
const Deleted = named('Deleted', z.object({ deleted: z.boolean() }));
const Count = named('Count', z.object({ count: z.number().int().nonnegative() }));
const MaybeSession = named('MaybeSession', SessionEntity.nullable());
const MaybeMessage = named('MaybeMessage', MessageEntity.nullable());
const MaybePart = named('MaybePart', PartEntity.nullable());
const MaybeToolPart = named('MaybeToolPart', ToolPartEntity.nullable());
const MaybeNative = named('MaybeNative', NativeRecord.nullable());
const MaybePendingAsk = named('MaybePendingAsk', PendingAskRecord.nullable());
const PendingAsks = named('PendingAsks', z.array(PendingAskRecord));
const MaybeQueued = named('MaybeQueued', QueuedMessageEntity.nullable());
const Parts = named('Parts', z.array(PartEntity));
const RootSessionParams = named('RootSessionParams', z.object({ rootSessionId: z.string() }));
const WorkspaceRootParams = named('WorkspaceRootParams', z.object({ workspaceId: z.string(), path: z.string() }));
const Changed = named('Changed', z.object({ changed: z.boolean() }));

const GrantTarget = {
  workspaceId: z.string(),
  toolName: z.string(),
  resource: z.string().describe('SDK PermissionResource.'),
  action: z.string().optional(),
  permissionKey: z.string(),
};
const CreateGrantParams = named('CreateGrantParams', z.object({
  ...GrantTarget,
  grantOptions: z.record(z.string(), z.unknown()).describe('SDK PermissionGrantOptions.'),
}));

const SearchCursor = named('SearchCursor', z.object({ sessionId: z.string(), timestamp: z.number() }));
const SearchPage = named('SearchPage', z.object({ sessionId: z.string(), timestamp: z.number(), limit: z.number().int().positive() }));
const MessageStamp = named('MessageStamp', z.object({ id: z.string(), timestamp: z.number() }));
const MessageRole = named('MessageRole', z.object({ id: z.string(), role: z.string(), timestamp: z.number() }));
const ToolSource = named('ToolSource', z.enum(['mcp', 'domain']).describe(
  'mcp: global and workspace MCP servers. domain: memory, skills, session search, scheduler.'));
const ToolContextSchema = named('ToolContext', z.object({
  workspaceId: z.string(),
  preconfigId: z.string().nullable(),
  path: z.string(),
}).describe('Session state captured when MCP access was granted; a change revokes access.'));
const ToolResult = named('ToolResult', z.object({
  content: z.array(z.record(z.string(), z.unknown())),
  structuredContent: z.record(z.string(), z.unknown()).optional(),
  isError: z.boolean().optional(),
}));
/** A Prokop tool's own result (`ToolResult` in @prokopai/sdk/tool), not the MCP shape. */
const CapabilityToolResult = named('CapabilityToolResult', z.object({
  success: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
}).passthrough());


const TerminalInfo = named('TerminalInfo', z.looseObject({
  id: z.string(),
  cwd: z.string(),
  status: z.string(),
  title: z.string(),
  exitCode: z.number().int().nullable().optional(),
  origin: z.enum(['user', 'agent']).optional(),
  lastActivityAt: z.number().optional(),
}));
const TerminalIdParams = named('TerminalIdParams', z.object({ terminalId: z.string() }));
const Written = named('Written', z.object({ written: z.boolean() }));

export const agentToHostRequests = requests({
  // Sessions ------------------------------------------------------------------
  'store.session.create': { description: 'Create a session (child sessions, forks).', params: z.object({ session: SessionEntity }), result: SessionEntity },
  'store.session.get': { description: 'Read a session.', params: Id, result: MaybeSession },
  'store.session.update': {
    description: 'Update session columns. metadataPatch is shallow-merged in the host, so concurrent writers do not lose keys.',
    params: z.object({ id: z.string(), updates: Updates, metadataPatch: z.record(z.string(), z.unknown()).optional() }),
    result: MaybeSession,
  },
  'store.session.handoffBrief': {
    description: 'Frozen brief for the current segment after a harness switch, or null.',
    params: z.object({ sessionId: z.string() }),
    result: z.object({ brief: z.string().nullable() }),
  },
  'store.session.children': { description: 'Child sessions (subagents, workflows) for interrupt cascade.', params: z.object({ parentId: z.string() }), result: z.array(SessionEntity) },

  // Messages ------------------------------------------------------------------
  'store.message.create': { description: 'Create a message with an agent-generated ID (upsert by ID).', params: z.object({ message: MessageEntity }), result: MessageEntity },
  'store.message.get': { description: 'Read one message.', params: Id, result: MaybeMessage },
  'store.message.getWithParts': { description: 'Read one message and its parts.', params: Id, result: MessageWithPartsEntity.nullable() },
  'store.message.update': { description: 'Patch a message (status, tokens, completion).', params: z.object({ id: z.string(), updates: Updates }), result: MaybeMessage },
  'store.message.delete': { description: 'Delete a message and its parts.', params: Id, result: Deleted },
  'store.message.list': { description: 'Full transcript.', params: SessionIdParams, result: z.array(MessageWithPartsEntity) },
  'store.message.page': { description: 'Latest transcript page.', params: z.object({ sessionId: z.string(), limit: z.number().int().positive().optional() }), result: TranscriptPage },
  'store.history.effective': { description: 'History after the latest compaction boundary, with handoff brief.', params: SessionIdParams, result: EffectiveContextHistory },

  // Parts ---------------------------------------------------------------------
  'store.part.create': { description: 'Create a part with an agent-generated ID (upsert by ID).', params: z.object({ sessionId: z.string(), part: PartEntity }), result: PartEntity },
  'store.part.get': { description: 'Read one part.', params: Id, result: MaybePart },
  'store.part.update': { description: 'Patch a part.', params: z.object({ id: z.string(), updates: Updates }), result: MaybePart },
  'store.part.listByMessage': { description: 'Parts of one message.', params: z.object({ messageId: z.string() }), result: Parts },
  'store.part.listBySession': { description: 'Parts of one session.', params: SessionIdParams, result: Parts },
  'store.part.byCallId': { description: 'Tool part by provider call ID.', params: z.object({ sessionId: z.string(), callId: z.string() }), result: MaybeToolPart },
  'store.part.snapshot': {
    description: 'Persist streamed text/reasoning so far. Deltas themselves travel as deliver part.append.',
    params: z.object({ snapshots: z.array(StreamingPartSnapshot) }),
    result: Count,
  },
  'store.tool.transition': {
    description: 'Move a tool part through its state machine. The host also derives files-changed notices from it.',
    params: z.object({
      target: z.union([z.object({ partId: z.string() }), z.object({ sessionId: z.string(), callId: z.string() })]),
      to: z.discriminatedUnion('state', [
        z.object({ state: z.literal('running'), childSessionId: z.string().optional() }),
        z.object({ state: z.literal('completed'), output: z.unknown() }),
        z.object({ state: z.literal('error'), error: z.string() }),
        z.object({ state: z.literal('interrupted'), reason: z.enum(['user_request', 'timeout', 'error', 'cascade']) }),
      ]),
    }),
    result: MaybeToolPart,
  },
  'store.index.sync': { description: 'Refresh full-text search for a finished message.', params: z.object({ messageId: z.string() }), result: Ack },
  'store.artifact.create': {
    description: 'Store oversized tool output.',
    params: z.object({
      sessionId: z.string(), workspaceId: z.string().optional(), toolCallId: z.string(),
      toolName: z.string(), content: z.string(), format: ToolOutputArtifactFormat,
    }),
    result: ToolOutputArtifact,
  },
  'store.artifact.page': {
    description: 'Read a page of stored tool output.',
    params: z.object({ sessionId: z.string(), artifactId: z.string(), offset: z.number().int().optional(), limit: z.number().int().optional() }),
    result: ToolOutputArtifactPage.nullable(),
  },
  'store.commit': { description: 'Atomic checks + writes in one host transaction (plan F3).', params: CommitParams, result: CommitResult },

  // Native harness state (F4) -------------------------------------------------
  'native.get': { description: 'Read one native record. Writes go through store.commit.', params: NativeKey, result: MaybeNative },
  'native.find': {
    description: 'Reverse lookup, e.g. Codex thread ID to session.',
    params: z.object({ harness: NativeRecord.shape.harness, kind: z.string(), lookup: z.string() }),
    result: MaybeNative,
  },

  // Queue, attachments, workspaces ---------------------------------------------
  'queue.peekSteer': { description: 'Oldest steer message for a running turn. Retire it with queue.delete in store.commit.', params: SessionIdParams, result: MaybeQueued },
  // queue.add/peek/delete serve the Prokop chat handler until queue drain moves host-side (1i).
  'queue.add': {
    description: 'Queue a prompt behind the running turn.',
    params: z.object({ sessionId: z.string(), content: z.string(), attachments: z.array(z.object({ id: z.string(), kind: z.string() })).optional() }),
    result: QueuedMessageEntity,
  },
  'queue.peek': { description: 'Oldest queued prompt of a session.', params: SessionIdParams, result: MaybeQueued },
  'queue.get': { description: 'One queued prompt, or null once sent or removed by the user.', params: Id, result: MaybeQueued },
  'queue.listSteer': {
    description: 'Every steer message of a session, oldest first (a run skips rows it already dispatched).',
    params: SessionIdParams, result: named('QueuedMessages', z.array(QueuedMessageEntity)),
  },
  'queue.delete': { description: 'Remove a queued prompt.', params: Id, result: Deleted },
  'responseFormat.get': { description: 'Read a structured response format.', params: Id, result: ResponseFormatEntity.nullable() },
  'attachment.get': { description: 'Attachment metadata; the agent reads absolutePath directly.', params: z.object({ sessionId: z.string(), attachmentId: z.string() }), result: AttachmentRecord.nullable() },
  'attachment.create': {
    description: 'Store a tool-produced file (Codex image outputs).',
    params: z.object({
      sessionId: z.string(), workspaceId: z.string(), filename: z.string(), mimeType: z.string(),
      sizeBytes: z.number().int().nonnegative(), dataBase64: z.string(),
    }),
    result: AttachmentRecord,
  },
  'workspace.get': { description: 'Read a workspace (child sessions, tools).', params: Id, result: WorkspaceEntity.nullable() },
  'workspace.resolveRoot': {
    description: 'Resolve the session root: a selected managed worktree replaces the workspace path. Fails when the worktree is unavailable or missing.',
    params: z.object({
      sessionId: z.string(), workspaceId: z.string().optional(), workspaceRootId: z.string().optional(),
      workspacePath: z.string().optional(), additionalPaths: z.array(z.string()).optional(),
    }),
    result: z.object({
      workspacePath: z.string().optional(),
      additionalPaths: z.array(z.string()).optional(),
      knowledgeRoot: z.string().optional()
        .describe('Workspace whose memory and skills the resolved path shares (a managed worktree maps to its main workspace).'),
    }),
  },
  'workspace.addRoot': { description: 'Persist an extra workspace root granted during a turn.', params: WorkspaceRootParams, result: Changed },
  'workspace.removeRoot': { description: 'Remove an extra workspace root.', params: WorkspaceRootParams, result: Changed },

  // Interaction storage (decision 6 A: waiters and validation stay in the agent)
  'interaction.createPendingAsk': { description: 'Store a pending ask row.', params: z.object({ record: PendingAskRecord.omit({ id: true }) }), result: z.object({ id: z.string() }) },
  'interaction.removePendingAsk': { description: 'Delete a pending ask row.', params: Id, result: Ack },
  'interaction.removeByToolCallId': { description: 'Delete pending ask rows for a tool call.', params: z.object({ toolCallId: z.string() }), result: Ack },
  'interaction.getRequest': { description: 'Read a permission request by request ID.', params: z.object({ requestId: z.string() }), result: MaybePendingAsk },
  'interaction.resolveRequest': {
    description: 'Mark a pending request approved or denied. resolved=false: it was no longer pending.',
    params: z.object({ requestId: z.string(), status: z.enum(['approved', 'denied']), resolution: z.unknown().optional() }),
    result: z.object({ resolved: z.boolean() }),
  },
  'interaction.resolveWithGrant': {
    description: 'Resolve and persist the remembered grant atomically (F3 approval transactions). A grant failure denies.',
    params: z.object({ requestId: z.string(), status: z.enum(['approved', 'denied']), resolution: z.unknown().optional(), grant: CreateGrantParams.optional() }),
    result: z.object({ resolved: z.boolean(), status: z.enum(['approved', 'denied']).describe('Denied when the grant could not be stored.') }),
  },
  'interaction.expireRequest': { description: 'Expire one pending request.', params: Id, result: z.object({ expired: z.boolean() }) },
  'interaction.expireOld': { description: 'Expire requests older than maxAgeMs.', params: z.object({ maxAgeMs: z.number().int().positive() }), result: Count },
  'interaction.cancelBySession': { description: 'Cancel pending requests of a session.', params: SessionIdParams, result: Count },
  'interaction.listBySession': { description: 'Pending asks of a session.', params: SessionIdParams, result: PendingAsks },
  'interaction.listByRoot': { description: 'Pending asks under a root session.', params: RootSessionParams, result: PendingAsks },
  'interaction.listRequestsByRoot': { description: 'Pending permission requests under a root session.', params: RootSessionParams, result: PendingAsks },
  'interaction.matchGrant': {
    description: 'Find a remembered grant covering this action.',
    params: z.object({ ...GrantTarget, rootSessionId: z.string().optional() }),
    result: z.object({ matched: z.boolean(), grant: PermissionGrantEntity.nullable() }),
  },
  'interaction.control': {
    description: 'Whether a session has an owner (who may be offline) and whether that owner is connected now.',
    params: SessionIdParams,
    result: z.object({ controlled: z.boolean(), connected: z.boolean() }),
  },
  'interaction.createGrant': { description: 'Persist a remembered grant.', params: CreateGrantParams, result: PermissionGrantEntity.nullable() },

  // Host-owned tools (MCP, browser, visuals, memory, skills, session search, scheduler)
  'tool.list': {
    description: 'Effective tool definitions for a session and workspace. For MCP, `context` captures the session state access was granted for; pass it back on every call.',
    params: z.object({ source: ToolSource, workspacePath: z.string(), sessionId: z.string().optional() }),
    result: z.object({
      tools: z.array(z.object({
        name: z.string(), serverName: z.string().optional(), toolName: z.string().optional(),
        description: z.string(), inputSchema: z.record(z.string(), z.unknown()),
      })),
      context: ToolContextSchema.optional(),
    }),
  },
  'tool.call': {
    description: 'Run a host-owned tool. The host re-checks access against `context` before running. Cancel with $/cancel.',
    params: z.object({
      source: ToolSource, name: z.string(), workspacePath: z.string(), sessionId: z.string().optional(),
      arguments: z.record(z.string(), z.unknown()),
      context: ToolContextSchema.optional(),
    }),
    result: ToolResult,
  },
  'sandbox.call': {
    description: 'Sandbox mode: a model call the agent made, answered by the host sandbox controller (rules or a sandbox client). Cancel with $/cancel when the call is aborted.',
    params: z.object({ context: z.record(z.string(), z.unknown()) }),
    result: z.record(z.string(), z.unknown()),
  },
  'learning.tool': {
    description: 'A learning review tool call (memory, skills, session_search, home_files). The host runs it against the review it opened for the session and rechecks the run\'s authorization.',
    params: z.object({ sessionId: z.string(), name: z.string(), arguments: z.unknown() }),
    result: CapabilityToolResult,
  },
  // Session search: one request per SessionSearchHost method (shared/session-search/host.ts).
  // The agent-side tool owns validation, scope rules and the permission ask.
  'search.workspace': { description: 'A workspace by ID.', params: Id, result: WorkspaceEntity.nullable() },
  'search.session': { description: 'A session by ID.', params: Id, result: SessionEntity.nullable() },
  'search.workspaceSessions': {
    description: 'Sessions of a workspace.', params: z.object({ workspaceId: z.string() }), result: z.array(SessionEntity),
  },
  'search.agentSessions': {
    description: 'Recent sessions of an agent across workspaces.',
    params: z.object({ agentId: z.string(), limit: z.number().int().positive() }), result: z.array(SessionEntity),
  },
  'search.countMessages': { description: 'Messages in a session.', params: SessionIdParams, result: Count },
  'search.messages': {
    description: 'Full-text search over messages.',
    params: z.object({
      query: z.string(), workspaceId: z.string().optional(), agentId: z.string().optional(),
      sessionId: z.string().optional(), roleFilter: z.array(z.string()), limit: z.number().int().positive(),
      sort: z.enum(['relevance', 'newest', 'oldest']),
    }),
    result: z.array(named('SearchMessageResult', z.object({
      messageId: z.string(), sessionId: z.string(), workspaceId: z.string(), role: z.string(), content: z.string(),
      timestamp: z.number(), sessionTitle: z.string().nullable(), rank: z.number(),
    }))),
  },
  'search.countBefore': {
    description: 'Messages of a session before a time.', params: SearchCursor, result: Count,
  },
  'search.countAfter': {
    description: 'Messages of a session after a time.', params: SearchCursor, result: Count,
  },
  'search.latestMessage': { description: 'Newest message of a session.', params: SessionIdParams, result: MessageStamp.nullable() },
  'search.message': {
    description: 'A message of a session.', params: z.object({ messageId: z.string(), sessionId: z.string() }),
    result: MessageStamp.nullable(),
  },
  'search.messagesBefore': {
    description: 'Messages of a session before a time, newest first.', params: SearchPage, result: z.array(MessageRole),
  },
  'search.messagesAfter': {
    description: 'Messages of a session after a time, oldest first.', params: SearchPage, result: z.array(MessageRole),
  },
  'search.messageSummary': {
    description: 'Role, time, text and tool name of a message.', params: z.object({ messageId: z.string() }),
    result: z.object({ role: z.string(), timestamp: z.number(), content: z.string(), toolName: z.string() }).nullable(),
  },
  'knowledge.apply': {
    description: 'Apply an approved memory or skill write on the host, which serializes knowledge writes with learning and settings. The agent already validated and asked.',
    params: z.object({
      kind: z.enum(['memory', 'skill']),
      directory: z.string(),
      input: z.record(z.string(), z.unknown()),
    }),
    result: z.record(z.string(), z.unknown()),
  },

  // Terminals (host owns the PTY) ----------------------------------------------
  'terminal.create': {
    description: 'Start a detached terminal. terminalId=null: cwd missing or spawn failed.',
    params: z.object({
      cwd: z.string(), workspaceId: z.string(), shell: z.string().optional(), cols: z.number().int().optional(),
      rows: z.number().int().optional(), origin: z.enum(['user', 'agent']).optional(),
      agentEnv: z.record(z.string(), z.string()).optional(), title: z.string().optional(),
      managedWorktreeId: z.string().optional(), ownerSessionId: z.string().optional(),
    }),
    result: z.object({ terminalId: z.string().nullable() }),
  },
  'terminal.get': { description: 'Terminal info, with the current execution cwd.', params: TerminalIdParams, result: z.object({ info: TerminalInfo.nullable(), executionCwd: z.string().nullable() }) },
  'terminal.list': { description: 'Terminals opened in a workspace path.', params: z.object({ workspacePath: z.string() }), result: z.array(TerminalInfo) },
  'terminal.write': { description: 'Write input to a running terminal.', params: z.object({ terminalId: z.string(), data: z.string() }), result: Written },
  'terminal.read': {
    description: 'Read buffered output from a byte offset.',
    params: z.object({ terminalId: z.string(), fromOffset: z.number().int().nonnegative().optional(), maxBytes: z.number().int().nonnegative().optional() }),
    result: z.object({ text: z.string(), nextOffset: z.number().int(), totalBytes: z.number().int() }).nullable(),
  },
  'terminal.setCwd': { description: 'Record the cwd a command left behind.', params: z.object({ terminalId: z.string(), cwd: z.string() }), result: Written },
  'terminal.destroy': { description: 'Kill a terminal.', params: TerminalIdParams, result: Ack },
});
