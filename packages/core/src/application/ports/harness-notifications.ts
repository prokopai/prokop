import type { AssistantMessage } from '@prokopai/sdk';

/**
 * Web-push hooks for native harnesses (Claude CLI, Codex CLI). The Prokop
 * runtime reaches the notification application through Capek host events;
 * native harnesses call this port at the same two moments: a top-level reply
 * reached a terminal status, and an approval or question waits for an answer.
 */
export interface HarnessNotificationPort {
  notifyTerminalMessage(message: AssistantMessage, sessionId: string): void;
  notifyAnswerRequired(requestId: string, rootSessionId: string): void;
  /** A session on this managed worktree changed (the host refreshes worktree attachments). */
  notifyWorktreeChanged?(worktreeId: string): void;
}

let current: HarnessNotificationPort | null = null;

export function installHarnessNotificationPort(port: HarnessNotificationPort): void {
  current = port;
}

export function getHarnessNotificationPort(): HarnessNotificationPort | null {
  return current;
}
