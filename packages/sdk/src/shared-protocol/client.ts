import type { ClientDescriptor } from './server';
import type { HarnessModelChoice, SessionHarness } from '../shared-types/session';

// No permission type imports needed — permission grant/deny messages removed.
// All permission responses go through ask.response (AskResponseMessage).

// =============================================================================
// Client Control: Descriptor
// =============================================================================

export type { ClientDescriptor };

// =============================================================================
// Client Control: Registration (Client → Server)
// =============================================================================

export interface ClientRegisterMessage {
  type: 'client.register';
  client: ClientDescriptor;
  reconnectToken?: string;
  currentSessionId?: string;
}

export interface SessionCreateMessage {
  type: 'session.create';
  /**
   * Client-chosen UUID for the new session, so the creating client can tell
   * its own `session.created` from sessions created elsewhere at the same time.
   */
  id?: string;
  workspaceId?: string;
  workspaceRootId?: string;
  preconfigId?: string;
  title?: string;
  harness?: SessionHarness;
}

export interface SessionResumeMessage {
  type: 'session.resume';
  sessionId: string;
}

import type { AttachmentKind } from '../shared-types/model';
import type { AskResponse } from '../shared-types/tool';

export interface ChatMessageAttachment {
  id: string;
  kind: AttachmentKind;
}

export interface ChatMessage {
  type: 'chat.message';
  sessionId: string;
  content: string;
  attachments?: ChatMessageAttachment[];
  responseFormatId?: string;
  goalCondition?: string;
  goalMaxTurns?: number;
  goalTokenBudget?: number;
  /** Client-generated id; the server answers with `chat.accepted` or `chat.rejected`. */
  clientMessageId?: string;
}

export interface SessionCloseMessage {
  type: 'session.close';
  sessionId: string;
}

export interface SessionUpdateMessage {
  type: 'session.update';
  sessionId: string;
  preconfigId?: string;
}

export interface SessionUpdateModelMessage {
  type: 'session.update_model';
  sessionId: string;
  modelId: string;
  providerId: string;
  variant?: string;
}

export interface SessionSelectHarnessModelMessage {
  type: 'session.select_harness_model';
  sessionId: string;
  choice: HarnessModelChoice;
}

export interface SessionReopenMessage {
  type: 'session.reopen';
  sessionId: string;
}

export interface SessionDeleteMessage {
  type: 'session.delete';
  sessionId: string;
}

export interface SessionGenerateTitleMessage {
  type: 'session.generate_title';
  sessionId: string;
}

export interface SessionRenameMessage {
  type: 'session.rename';
  sessionId: string;
  title: string;
}

// =============================================================================
// Permission Grant Management (Client → Server)
// =============================================================================

export interface PermissionListRequestMessage {
  type: 'permission.list';
  workspaceId: string;
  includeRevoked?: boolean;
}

export interface PermissionRevokeMessage {
  type: 'permission.revoke';
  grantId: string;
}

export interface PermissionRevokeAllMessage {
  type: 'permission.revoke_all';
  workspaceId: string;
}



// =============================================================================
// Compaction Messages
// =============================================================================

export interface SessionCompactMessage {
  type: 'session.compact';
  sessionId: string;
}

// =============================================================================
// Revert Messages
// =============================================================================

export interface SessionRevertMessage {
  type: 'session.revert';
  sessionId: string;
  messageId: string;
}

// =============================================================================
// Fork Messages
// =============================================================================

export interface SessionForkMessage {
  type: 'session.fork';
  sessionId: string;
  messageId: string;
  title?: string;
}

// =============================================================================
// Edit Message Messages
// =============================================================================

export interface SessionEditMessageMessage {
  type: 'session.edit_message';
  sessionId: string;
  messageId: string;
  content: string;
}

// =============================================================================
// Interrupt Messages
// =============================================================================

export interface SessionInterruptMessage {
  type: 'session.interrupt';
  sessionId: string;
  reason?: 'user_request' | 'timeout' | 'error';
}

// =============================================================================
// Queue Messages
// =============================================================================

export interface QueueAddMessage {
  type: 'queue.add';
  sessionId: string;
  content: string;
  attachments?: ChatMessageAttachment[];
  responseFormatId?: string;
  /** Client-generated id; the server answers with `chat.accepted` or `chat.rejected`. */
  clientMessageId?: string;
  /** Deliver into the running turn instead of after it, when the runtime can. */
  steer?: boolean;
}

export interface QueueRemoveMessage {
  type: 'queue.remove';
  queueId: string;
}

/** Marks a queued message to be delivered into the running turn. */
export interface QueueSteerMessage {
  type: 'queue.steer';
  queueId: string;
}

export interface ProviderConnectMessage {
  type: 'provider.connect';
  provider: string;
  redirectStrategy?: string;
}

export interface ProviderDisconnectMessage {
  type: 'provider.disconnect';
  provider: string;
}

// =============================================================================
// Ask Messages (Client → Server)
// =============================================================================

export interface AskResponseMessage {
  type: 'ask.response';
  toolCallId: string;
  response: AskResponse;
  /** Canonical request identity for permission asks. Used to correlate responses. */
  requestId?: string;
}

export interface SandboxTextResponse {
  type: 'text';
  content: string;
}

export interface SandboxToolCallResponse {
  type: 'tool-call';
  toolName: string;
  args: Record<string, unknown>;
  toolCallId?: string;
}

export interface SandboxMultiToolCallResponse {
  type: 'multi-tool-call';
  calls: Array<{
    toolName: string;
    args: Record<string, unknown>;
    toolCallId?: string;
  }>;
}

export interface SandboxErrorResponse {
  type: 'error';
  error: string;
  errorType?: 'rate_limit' | 'server' | 'timeout' | 'auth' | 'invalid_request';
}

export interface SandboxReasoningResponse {
  type: 'reasoning';
  reasoning: string;
  text: string;
}

export type SandboxResponse =
  | SandboxTextResponse
  | SandboxToolCallResponse
  | SandboxMultiToolCallResponse
  | SandboxErrorResponse
  | SandboxReasoningResponse;

export interface SandboxRespondMessage {
  type: 'sandbox.respond';
  callId: string;
  response: SandboxResponse;
}

// =============================================================================
// Control Action Messages (Client → Server)
// =============================================================================

export interface SessionControlClaimMessage {
  type: 'session.control.claim';
  sessionId: string;
}

export interface SessionControlReleaseMessage {
  type: 'session.control.release';
  sessionId: string;
}

// =============================================================================
// Notification Messages
// =============================================================================

export interface NotificationAcknowledgeMessage {
  type: 'notification.acknowledge';
  eventId: string;
  sessionId: string;
}

// =============================================================================
// Heartbeat Messages
// =============================================================================

/** Answers the server's `ping`. */
export interface PongMessage {
  type: 'pong';
}

/**
 * Asks the server to answer at once. Sent when the page returns to the
 * foreground: a socket the OS cut in the background still reports open, and
 * only a reply proves it is alive.
 */
export interface ClientPingMessage {
  type: 'ping';
}

/**
 * Whether someone is at this device: the window is visible and focused and
 * had input within the last couple of minutes. Sent on every change and
 * refreshed about once a minute while true. While any device is attended,
 * the server holds its push notifications: that device signals locally.
 */
export interface ClientAttentionMessage {
  type: 'client.attention';
  attending: boolean;
}

// =============================================================================
// Git Status Feed Messages
// =============================================================================

/** Start receiving `git.status` for a workspace root; the server replies with a snapshot. */
export interface GitStatusSubscribeMessage {
  type: 'git.status.subscribe';
  workspaceId: string;
  root?: string;
}

export interface GitStatusUnsubscribeMessage {
  type: 'git.status.unsubscribe';
  workspaceId: string;
  root?: string;
}

/** Recompute now (window focus); pushes only if the status changed. */
export interface GitStatusRefreshMessage {
  type: 'git.status.refresh';
  workspaceId: string;
  root?: string;
}

// =============================================================================
// File Tree Feed Messages
// =============================================================================

/** Start receiving `files.tree` for a workspace root; the server replies with a snapshot. */
export interface FileTreeSubscribeMessage {
  type: 'files.tree.subscribe';
  workspaceId: string;
  root?: string;
}

export interface FileTreeUnsubscribeMessage {
  type: 'files.tree.unsubscribe';
  workspaceId: string;
  root?: string;
}

/** Rewalk now (window focus, manual refresh); pushes only if paths changed. */
export interface FileTreeRefreshMessage {
  type: 'files.tree.refresh';
  workspaceId: string;
  root?: string;
}

export type ClientMessage = 
  | ClientRegisterMessage
  | SessionCreateMessage 
  | SessionResumeMessage
  | ChatMessage
  | SessionCloseMessage
  | SessionUpdateMessage
  | SessionUpdateModelMessage
  | SessionSelectHarnessModelMessage
  | SessionReopenMessage
  | SessionDeleteMessage
  | SessionRenameMessage
  | SessionGenerateTitleMessage
  | PermissionListRequestMessage
  | PermissionRevokeMessage
  | PermissionRevokeAllMessage
  | SessionCompactMessage
  | SessionRevertMessage
  | SessionForkMessage
  | SessionEditMessageMessage
  | SessionInterruptMessage
  | QueueAddMessage
  | QueueRemoveMessage
  | QueueSteerMessage
  | ProviderConnectMessage
  | ProviderDisconnectMessage
  | AskResponseMessage
  | SandboxRespondMessage
  | SessionControlClaimMessage
  | SessionControlReleaseMessage
  | NotificationAcknowledgeMessage
  | PongMessage
  | ClientPingMessage
  | ClientAttentionMessage
  | GitStatusSubscribeMessage
  | GitStatusUnsubscribeMessage
  | GitStatusRefreshMessage
  | FileTreeSubscribeMessage
  | FileTreeUnsubscribeMessage
  | FileTreeRefreshMessage;