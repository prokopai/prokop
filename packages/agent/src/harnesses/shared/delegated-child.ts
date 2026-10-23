import { delegationHost } from '@prokopai/core/application/ports/delegation-host';

/**
 * A session with a parent that a delegation started, as opposed to a native
 * CLI subagent thread (a Claude agent or a Codex collab thread), which the
 * CLI process itself drives. The host runs a delegated child like a
 * top-level session; the task row the delegation wrote is the proof.
 */
export function isDelegatedChild(sessionId: string): boolean {
  return delegationHost().tasks.get(sessionId)?.kind === 'child';
}
