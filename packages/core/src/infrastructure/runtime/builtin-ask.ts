/**
 * One ask path for tools that run outside a harness's own approval flow
 * (the delegation runtime tools on every harness): auto-approve by the
 * session's permission mode, refuse without a controller, otherwise store the
 * ask, show it where the user is, and wait for the answer, the permission
 * timeout or the caller's abort (an interrupted turn aborts the tool call on
 * every harness). The answer is returned raw; the caller reads
 * the grant it needs (a remembered delegation target is a preconfig write, not
 * a permission grant row). Answers arrive through the agent ask port under the
 * `builtin-ask:` prefix.
 */

import type { AskAuthority, PermissionAsk } from '@prokopai/sdk';
import { shouldAutoApproveAsk } from '../../domains/permissions';
import { getHarnessNotificationPort } from '../../application/ports/harness-notifications';
import { getPermissionTimeoutMs } from './environment';
import { harnessAsks } from './harness-asks';
import { emitToAskTargets, emitToSession, getSession } from './host-dependencies';

export const BUILTIN_ASK_PREFIX = 'builtin-ask:';

/** Shown to the session's ask targets, answered by its controller. */
const AUTHORITY: AskAuthority = { visibilityScope: 'controller_only', resolutionMode: 'controller_only' };

interface Pending {
  toolCallId: string;
  sessionId: string;
  dbId: string;
  timer: ReturnType<typeof setTimeout>;
  finish: (answer: unknown) => void;
  detach: () => void;
}

const pending = new Map<string, Pending>();
const byTool = new Map<string, string>();

function settle(requestId: string, answer: unknown, expired: boolean): void {
  const entry = pending.get(requestId);
  if (!entry) return;
  pending.delete(requestId);
  byTool.delete(entry.toolCallId);
  clearTimeout(entry.timer);
  entry.detach();
  if (expired) {
    void harnessAsks().expireRequest(entry.dbId).catch((error: unknown) => {
      console.warn('[builtin-ask] expiry failed:', error instanceof Error ? error.message : 'unknown error');
    });
  }
  try {
    emitToSession(entry.sessionId, { kind: 'ask', action: 'timed_out', sessionId: entry.sessionId, toolCallId: entry.toolCallId, requestId });
  } catch { /* the waiter is settled either way */ }
  entry.finish(answer);
}

/**
 * Asks the user on behalf of `toolName` in `sessionId`. Resolves with the raw
 * answer, or `null` when nobody could be asked, the user declined, the ask
 * timed out or the call was aborted. An auto-approved ask resolves with a
 * once grant.
 */
export async function askUserForBuiltin(sessionId: string, toolName: string, ask: PermissionAsk,
  signal?: AbortSignal): Promise<unknown> {
  if (signal?.aborted) return null;
  const session = await getSession(sessionId);
  if (!session) return null;
  if (shouldAutoApproveAsk(ask, session.permissionMode ?? 'standard')) return { type: 'permission', grant: 'once' };
  if (!(await harnessAsks().sessionControl(sessionId)).controlled) return null;
  const requestId = crypto.randomUUID();
  const toolCallId = `${BUILTIN_ASK_PREFIX}${crypto.randomUUID()}`;
  const timeout = getPermissionTimeoutMs();
  const now = Date.now();
  const dbId = await harnessAsks().createPendingAsk({ requestId, toolCallId, toolName, sessionId, rootSessionId: sessionId,
    workspaceId: session.workspaceId, ask, isPermission: true, status: 'pending', createdAt: now, expiresAt: now + timeout });
  return new Promise<unknown>(resolve => {
    const abort = (): void => settle(requestId, null, true);
    const timer = setTimeout(abort, timeout);
    signal?.addEventListener('abort', abort, { once: true });
    pending.set(requestId, { toolCallId, sessionId, dbId, timer, finish: resolve,
      detach: () => signal?.removeEventListener('abort', abort) });
    byTool.set(toolCallId, requestId);
    try {
      emitToAskTargets(sessionId, AUTHORITY, { kind: 'ask', action: 'requested', sessionId, toolCallId, toolName, ask, requestId, authority: AUTHORITY });
      getHarnessNotificationPort()?.notifyAnswerRequired(requestId, sessionId);
    } catch {
      abort();
    }
  });
}

/** The waiters of this process, for the agent ask port. */
export const builtinAsks = {
  isBuiltinAskId: (toolCallId: string): boolean => toolCallId.startsWith(BUILTIN_ASK_PREFIX),
  getSessionId(toolCallId: string, requestId?: string): string | null {
    if (!requestId || byTool.get(toolCallId) !== requestId) return null;
    return pending.get(requestId)?.sessionId ?? null;
  },
  authority: AUTHORITY,
  hasLiveRequest: (requestId: string): boolean => pending.has(requestId),
  /** Records the answer and wakes the waiter; false when the ask is no longer waiting. */
  async resolve(toolCallId: string, response: unknown, requestId?: string): Promise<boolean> {
    if (!requestId || byTool.get(toolCallId) !== requestId) return false;
    const entry = pending.get(requestId);
    if (!entry) return false;
    // Only a connected controller may answer.
    const { connected } = await harnessAsks().sessionControl(entry.sessionId);
    const value = response && typeof response === 'object' && !Array.isArray(response) ? response as Record<string, unknown> : null;
    // The client answers with a grant scope, or the grant 'deny'.
    const approved = connected && value?.type === 'permission' && typeof value.grant === 'string' && value.grant !== 'deny';
    const { resolved } = await harnessAsks().resolveRequest(requestId, approved ? 'approved' : 'denied', response);
    if (!resolved) {
      settle(requestId, null, true);
      return false;
    }
    settle(requestId, approved ? response : null, false);
    return true;
  },
};
