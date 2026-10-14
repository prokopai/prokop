import { z } from 'zod';
import type {
  Ask,
  AskAuthority,
  Message,
  MessageWithParts,
  Part,
  PermissionGrant,
  Preconfig,
  QueuedMessage,
  ResponseFormat,
  ServerMessage,
  Session,
  ToolPart,
  Workspace,
} from '@prokopai/sdk/types';
import { entity, named } from './registry';

// SDK entities. The host stores and forwards them; it reads only the keys
// listed here. Full shapes live in `@prokopai/sdk`.

export const SessionHarness = named('SessionHarness', z.enum(['prokop', 'codex-cli', 'claude-cli']));

export const SessionEntity = entity<Session>('Session', {
  id: z.string(),
  workspaceId: z.string(),
  harness: SessionHarness.optional(),
  parentId: z.string().nullable().optional(),
}, 'SDK Session. The host maps known fields to session columns.');

export const MessageEntity = entity<Message>('Message', {
  id: z.string(),
  sessionId: z.string(),
  role: z.enum(['user', 'assistant']),
}, 'SDK Message (user or assistant).');

export const PartEntity = entity<Part>('Part', {
  id: z.string(),
  messageId: z.string(),
  type: z.string(),
}, 'SDK Part. Stored as `type` + JSON data; the host interprets only tool parts.');

export const ToolPartEntity = entity<ToolPart>('ToolPart', {
  id: z.string(),
  messageId: z.string(),
  type: z.literal('tool'),
}, 'SDK tool Part, including its state machine.');

export const MessageWithPartsEntity = named('MessageWithParts', z.object({
  message: MessageEntity,
  parts: z.array(PartEntity),
})) as unknown as z.ZodType<MessageWithParts>;

export const WorkspaceEntity = entity<Workspace>('Workspace', {
  id: z.string(),
  path: z.string(),
}, 'SDK Workspace.');

export const QueuedMessageEntity = entity<QueuedMessage>('QueuedMessage', {
  id: z.string(),
  sessionId: z.string(),
  content: z.string(),
}, 'SDK QueuedMessage.');

export const ResponseFormatEntity = entity<ResponseFormat>('ResponseFormat', {
  id: z.string(),
}, 'SDK ResponseFormat (structured output schema).');

export const PreconfigEntity = entity<Preconfig>('Preconfig', {
  id: z.string(),
}, 'SDK Preconfig, resolved by the host for headless runs.');

export const AskEntity = entity<Ask>('Ask', {
  type: z.string(),
}, 'SDK Ask (permission or question form).');

export const PermissionGrantEntity = entity<PermissionGrant>('PermissionGrant', {
  id: z.string(),
}, 'SDK PermissionGrant.');

export const AskAuthoritySchema = named('AskAuthority', z.looseObject({
  visibilityScope: z.enum(['controller_only', 'session_participants', 'global']),
  resolutionMode: z.enum(['controller_only', 'designated_clients', 'first_eligible']),
  allowedResponderClientIds: z.array(z.string()).optional(),
  requiredCapabilities: z.array(z.string()).optional(),
})) as unknown as z.ZodType<AskAuthority>;

export const ServerMessageEntity = entity<ServerMessage>('ServerMessage', {
  type: z.string(),
}, 'Client wire message, already mapped by the agent. The host routes it and never rewrites it.');

// Protocol-owned records. These mirror server contracts
// (`infrastructure/storage/contracts.ts`, `infrastructure/runtime/host.ts`)
// and are fully typed because the host stores them field by field.

export const AttachmentRecord = named('AttachmentRecord', z.object({
  id: z.string(),
  sessionId: z.string(),
  workspaceId: z.string(),
  kind: z.enum(['image', 'video', 'file']),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  absolutePath: z.string().describe('Same machine: the agent reads the file directly.'),
  createdAt: z.string(),
  accessKey: z.string(),
}));
export type AttachmentRecord = z.infer<typeof AttachmentRecord>;

export const EffectiveContextHistory = named('EffectiveContextHistory', z.object({
  messages: z.array(MessageWithPartsEntity),
  latestCompactionBoundary: z.string().nullable(),
  hasCompaction: z.boolean(),
  handoffBrief: z.string().nullable().optional().describe('Frozen brief for the current segment after a harness switch.'),
}));

export const TranscriptPage = named('TranscriptPage', z.object({
  messages: z.array(MessageWithPartsEntity),
  pagination: z.object({
    hasOlder: z.boolean(),
    oldestSequence: z.number().nullable(),
    newestSequence: z.number().nullable(),
    limit: z.number().int(),
  }),
}));

export const StreamingPartSnapshot = named('StreamingPartSnapshot', z.object({
  id: z.string(),
  messageId: z.string(),
  sessionId: z.string(),
  type: z.enum(['text', 'reasoning']),
  createdAt: z.number(),
  text: z.string(),
}));

export const ToolOutputArtifactFormat = named('ToolOutputArtifactFormat', z.enum(['json', 'text']));

export const ToolOutputArtifact = named('ToolOutputArtifact', z.object({
  id: z.string(),
  sessionId: z.string(),
  workspaceId: z.string().optional(),
  toolCallId: z.string(),
  toolName: z.string(),
  content: z.string(),
  format: ToolOutputArtifactFormat,
  size: z.number().int(),
  createdAt: z.number(),
}));

export const ToolOutputArtifactPage = named('ToolOutputArtifactPage', z.object({
  artifactId: z.string(),
  toolCallId: z.string(),
  toolName: z.string(),
  format: ToolOutputArtifactFormat,
  content: z.string(),
  offset: z.number().int(),
  limit: z.number().int(),
  totalChars: z.number().int(),
  nextOffset: z.number().int().nullable(),
  complete: z.boolean(),
}));

export const PermissionRequestStatus = named('PermissionRequestStatus',
  z.enum(['pending', 'approved', 'denied', 'expired', 'cancelled']));

export const PendingAskRecord = named('PendingAskRecord', z.object({
  id: z.string(),
  requestId: z.string(),
  sessionId: z.string(),
  rootSessionId: z.string().optional(),
  originSessionId: z.string().optional(),
  workspaceId: z.string().optional(),
  toolCallId: z.string(),
  toolName: z.string(),
  ask: AskEntity,
  status: PermissionRequestStatus,
  isPermission: z.boolean(),
  expiresAt: z.number().optional(),
  resolvedAt: z.number().optional(),
  resolution: z.unknown().optional(),
  createdAt: z.number(),
}));
export type PendingAskRecord = z.infer<typeof PendingAskRecord>;

/**
 * One row of harness-private native state (decision F4 option A): Claude and
 * Codex bindings, rollback and fork intents, inherited user IDs, model
 * selections. The host interprets only `blocksSwitch`, the cascades
 * (`sessionId`, `messageId`) and `kind = 'model'`.
 */
export const NativeRecord = named('NativeRecord', z.object({
  harness: z.enum(['codex-cli', 'claude-cli']),
  kind: z.string().describe("e.g. 'binding', 'rollback-intent', 'fork-intent', 'inherited-user', 'model'"),
  key: z.string(),
  sessionId: z.string().describe('Owning session; rows are deleted with it.'),
  messageId: z.string().nullable().optional().describe('Owning message; rows are deleted with it.'),
  lookup: z.string().nullable().optional().describe('Unique per harness + kind; reverse lookup such as a Codex thread ID.'),
  blocksSwitch: z.boolean().describe('While present, the host refuses a harness switch for the session.'),
  value: z.unknown().describe('Opaque to the host, except kind "model" ({ model, effort }).'),
}));
export type NativeRecord = z.infer<typeof NativeRecord>;

export const NativeKey = named('NativeKey', z.object({
  harness: NativeRecord.shape.harness,
  kind: z.string(),
  key: z.string(),
}));
