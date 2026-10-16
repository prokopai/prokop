import type { AutoApproveSeverity, Message, MessageWithParts, Part, QueuedMessage, ResponseFormat, Session, ToolPart, Workspace } from '@prokopai/sdk/types';
import type {
  AttachmentRecord,
  StreamingPartSnapshot,
  ToolOutputArtifactPage,
  TranscriptPage,
} from '../../application/ports/session';

export type { AttachmentRecord, StreamingPartSnapshot, ToolOutputArtifactPage, TranscriptPage };

export interface EffectiveContextHistory {
  messages: MessageWithParts[];
  latestCompactionBoundary: string | null;
  hasCompaction: boolean;
  /** Frozen brief for the current segment after a harness switch. */
  handoffBrief?: string | null;
}

export type SessionUpdates = Partial<Pick<Session,
  | 'title'
  | 'status'
  | 'metadata'
  | 'preconfigId'
  | 'selectedModel'
  | 'selectedProvider'
  | 'selectedVariant'
  | 'promptTokens'
  | 'completionTokens'
  | 'totalTokens'
  | 'cacheReadTokens'
  | 'cacheWriteTokens'
  | 'noCacheTokens'
  | 'parentId'
  | 'agentName'
  | 'subagentStatus'
  | 'runningAt'
  | 'compacting'
  | 'tags'
  | 'autoApproveSeverity'
  | 'agentId'
>>;

export interface ConversationStore {
  createSession(session: Omit<Session, 'createdAt' | 'updatedAt'> & { createdAt?: string; updatedAt?: string }): Promise<Session>;
  getSession(id: string): Promise<Session | null>;
  updateSession(id: string, updates: SessionUpdates): Promise<Session | null>;
  getChildSessions(parentId: string): Promise<Session[]>;
  /** Frozen brief for the current segment after a harness switch, or null. */
  getHandoffBrief(sessionId: string): Promise<string | null>;
  createMessage(message: Message): Promise<Message>;
  getMessage(id: string): Promise<Message | null>;
  getMessageWithParts(messageId: string): Promise<MessageWithParts | null>;
  updateMessage(id: string, updates: Partial<Message>): Promise<Message | null>;
  deleteMessage(messageId: string): Promise<boolean>;
  listMessagesWithParts(sessionId: string): Promise<MessageWithParts[]>;
  listLatestMessagesWithPartsPage(sessionId: string, limit?: number): Promise<TranscriptPage>;
  buildEffectiveContextHistory(sessionId: string): Promise<EffectiveContextHistory>;
  createPart(part: Part, sessionId: string): Promise<Part>;
  getPart(id: string): Promise<Part | null>;
  getPartsByMessage(messageId: string): Promise<Part[]>;
  getPartsBySession(sessionId: string): Promise<Part[]>;
  updatePart(id: string, updates: Record<string, unknown>): Promise<Part | null>;
  persistStreamingPartSnapshots(snapshots: StreamingPartSnapshot[]): Promise<number>;
  transitionToolToRunningByCallId(sessionId: string, callId: string, childSessionId?: string): Promise<ToolPart | null>;
  transitionToolToInterrupted(partId: string, reason: 'user_request' | 'timeout' | 'error' | 'cascade'): Promise<ToolPart | null>;
  getToolPartByCallId(sessionId: string, callId: string): Promise<ToolPart | null>;
  transitionToolToCompleted(partId: string, output: unknown): Promise<ToolPart | null>;
  transitionToolToError(partId: string, error: string): Promise<ToolPart | null>;
}

/** Claude Code and Codex native state (plan F4): bindings, intents, inherited IDs, model selections. */
export type NativeHarness = 'codex-cli' | 'claude-cli';

export interface NativeKey {
  harness: NativeHarness;
  kind: string;
  key: string;
}

export interface NativeRecord<V = unknown> extends NativeKey {
  sessionId: string;
  messageId?: string | null;
  /** Unique per harness and kind; a reverse lookup such as a native thread ID. */
  lookup?: string | null;
  /** While present, the host refuses a harness switch for the session. */
  blocksSwitch: boolean;
  value: V;
}

/** Reads only. Native writes go through `StorageBundle.commit`. */
export interface NativeStateStore {
  get<V = unknown>(target: NativeKey): Promise<NativeRecord<V> | null>;
  find<V = unknown>(harness: NativeHarness, kind: string, lookup: string): Promise<NativeRecord<V> | null>;
}

type Updates = Record<string, unknown>;

/** One write of an atomic commit. */
export type CommitWrite =
  | { op: 'session.create'; session: Parameters<ConversationStore['createSession']>[0] }
  | { op: 'session.update'; id: string; updates: Updates; metadataPatch?: Record<string, unknown> }
  | { op: 'message.create'; message: Message }
  | { op: 'message.update'; id: string; updates: Updates }
  | { op: 'message.delete'; id: string; ifExists?: boolean }
  | { op: 'part.create'; sessionId: string; part: Part }
  | { op: 'part.update'; id: string; updates: Updates }
  | { op: 'queue.delete'; id: string; ifExists?: boolean }
  | { op: 'native.put'; record: NativeRecord }
  | { op: 'native.delete'; target: NativeKey; ifExists?: boolean };

/** A compare-and-set guard of an atomic commit; mirrors `CommitCheck`. */
export type CommitCheck =
  | { check: 'native.equals'; target: NativeKey; value: Record<string, unknown> }
  | { check: 'native.absent'; target: NativeKey }
  | { check: 'session.messageIds'; sessionId: string; ids: string[] }
  | { check: 'session.harness'; sessionId: string; harness: string }
  | { check: 'queue.present'; id: string };

export interface CommitRequest {
  checks?: CommitCheck[];
  writes: CommitWrite[];
}

export type CommitResult =
  | { ok: true; results: unknown[] }
  | { ok: false; failed: { kind: 'check' | 'write'; index: number; message?: string } };

export type ToolOutputArtifactFormat = 'json' | 'text';

export interface ToolOutputArtifact {
  id: string;
  sessionId: string;
  workspaceId?: string;
  toolCallId: string;
  toolName: string;
  content: string;
  format: ToolOutputArtifactFormat;
  size: number;
  createdAt: number;
}

export type CreateToolOutputArtifact = Omit<ToolOutputArtifact, 'id' | 'size' | 'createdAt'>;


export interface ToolOutputArtifactStore {
  create(input: CreateToolOutputArtifact): Promise<ToolOutputArtifact>;
  getPage(sessionId: string, artifactId: string, offset?: number, limit?: number): Promise<ToolOutputArtifactPage | null>;
}

export interface MessageQueueStore {
  addMessage(sessionId: string, content: string, attachments?: Array<{ id: string; kind: string }>): Promise<QueuedMessage>;
  peek(sessionId: string): Promise<QueuedMessage | null>;
  /** The oldest message marked for delivery into the running turn. */
  peekSteer(sessionId: string): Promise<QueuedMessage | null>;
  /** Every steer message, oldest first. */
  listSteer(sessionId: string): Promise<QueuedMessage[]>;
  /** One queued message; null once sent or removed. */
  get(id: string): Promise<QueuedMessage | null>;
  delete(id: string): Promise<boolean>;
}

export interface CreateAttachmentInput {
  sessionId: string;
  workspaceId: string;
  filename: string;
  mimeType: string;
  data: Uint8Array;
}

export interface AttachmentStore {
  get(sessionId: string, attachmentId: string): Promise<AttachmentRecord | null>;
  /** Stores a tool-produced file (Codex image outputs). */
  create(input: CreateAttachmentInput): Promise<AttachmentRecord>;
}

export interface WorkspaceStore {
  get(id: string): Promise<Workspace | null>;
  /** @deprecated Permissions-v2 hosts resolve their own permission mode;
   * consumers treat an absent getter as inherited (undefined). */
  getAutoApproveSeverity?(workspaceId: string): Promise<AutoApproveSeverity>;
}

export interface ResponseFormatStore {
  get(id: string): Promise<ResponseFormat | null>;
}

export interface ConversationIndex {
  syncMessage(messageId: string): Promise<void>;
  removeMessage?(messageId: string): Promise<void>;
}

export interface StorageBundle {
  conversation: ConversationStore;
  toolOutputArtifacts: ToolOutputArtifactStore;
  queue: MessageQueueStore;
  attachments: AttachmentStore;
  workspaces: WorkspaceStore;
  responseFormats: ResponseFormatStore;
  index: ConversationIndex;
  native: NativeStateStore;
  /**
   * Runs every check, then every write, atomically. A failed check, or an
   * update or delete that matches no row (unless `ifExists`), changes nothing.
   * Use `storeTransaction` (`./transaction`) rather than calling this directly.
   */
  commit(request: CommitRequest): Promise<CommitResult>;
}
