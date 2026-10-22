import type { SessionHarness } from '@prokopai/sdk';

/** An ask (permission or question) that just opened on a session. */
export interface DelegationAskNotice {
  sessionId: string;
  requestId: string;
  toolName: string;
}

/**
 * What the host knows about harnesses that a delegation needs before a child
 * exists (enabled in settings, installed on this machine, children allowed
 * per root), and what a running task needs from the host afterwards: a way
 * to put a result in front of the parent, to hear about a child's asks, and
 * to stop a child. Installed by the server bootstrap; without it every
 * harness counts as enabled and available and deliveries go nowhere, so
 * tests and single-harness hosts need no wiring.
 */
export interface DelegationHostPort {
  harnessEnabled(harness: SessionHarness): boolean;
  harnessAvailable(harness: SessionHarness): boolean;
  /** Running children allowed per root session. */
  maxChildren(): number;
  /** Puts a message in front of a session's model (the delivery primitive). */
  deliver(input: { sessionId: string; content: string; key: string }): Promise<void>;
  /** Fires for every ask opened on any session; returns the unsubscribe. */
  onAskCreated(listener: (ask: DelegationAskNotice) => void): () => void;
  /** Whether the session or one of its descendants has an open ask. */
  hasPendingAsk(sessionId: string): boolean;
  /** Stops a session's turn (cancel). */
  interrupt(sessionId: string, reason: string): Promise<void>;
}

export const DEFAULT_MAX_DELEGATION_CHILDREN = 4;

const permissive: DelegationHostPort = {
  harnessEnabled: () => true,
  harnessAvailable: () => true,
  maxChildren: () => DEFAULT_MAX_DELEGATION_CHILDREN,
  deliver: async () => {},
  onAskCreated: () => () => {},
  hasPendingAsk: () => false,
  interrupt: async () => {},
};

let current: DelegationHostPort = permissive;

export function installDelegationHost(port: DelegationHostPort | null): void {
  current = port ?? permissive;
}

export function delegationHost(): DelegationHostPort {
  return current;
}
