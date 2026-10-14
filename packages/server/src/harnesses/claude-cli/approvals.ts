import type { CanUseTool, PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import type { Ask } from '@prokopai/sdk';
import { shouldAutoApproveAsk } from '@/domains/permissions';
import { classifyClaudeTool } from './tool-policy';
import { CLAUDE_QUESTION_TOOL, claudeQuestionAnswers, claudeQuestionAsk, parseClaudeQuestions,
  type ClaudeQuestion } from './questions';
import { sessionPermissionRoots } from '@/harnesses/shared/permission-roots';
import { notifyHarnessPermissionRequired } from '@/harnesses/shared/notifications';
import type { ApplicationDeliveryPort } from '@/application/ports/delivery';
import { getPermissionTimeoutMs } from '@/infrastructure/runtime/environment';
import { createPendingAsk, expirePermissionRequest, resolvePermissionRequestByRequestId } from '@/infrastructure/sqlite/pending-asks';
import { createGrantFromOptions, matchGrant } from '@/infrastructure/sqlite/permissions';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { getSession, getWorkspace } from '@/infrastructure/storage/runtime';
import { getControllerConnections, isControlled } from '@/transport/websocket/control-registry';

const AUTHORITY = { visibilityScope: 'controller_only', resolutionMode: 'controller_only' } as const;
const BASH_TOOL = 'claude-cli:Bash';
const denied = (message: string): PermissionResult => ({ behavior: 'deny', message });

interface Pending {
  sessionId: string;
  controllerSessionId: string;
  toolCallId: string;
  dbId: string;
  timer: ReturnType<typeof setTimeout>;
  finish(result: PermissionResult): void;
  delivery: ApplicationDeliveryPort<unknown>;
  /** Remembered-grant key (exact [root, command]); null when the ask is once-only. */
  key: string | null;
  /** Grant scopes the ask offered; responses outside them fail closed. */
  scopes: readonly string[];
  workspaceId: string;
  /** Set for AskUserQuestion: answered with the user's choices, never a grant. */
  question: PendingQuestion | null;
}

interface PendingQuestion {
  questions: ClaudeQuestion[];
  /** The tool's original input; answers are added to it as updatedInput. */
  input: Record<string, unknown>;
}

/** Live approval waiters are never restored from SQLite after a process restart. */
export class ClaudeApprovals {
  private readonly pending = new Map<string, Pending>();
  private readonly byTool = new Map<string, string>();
  constructor(private readonly timeoutMs: () => number = getPermissionTimeoutMs) {}

  hasLiveRequest(requestId: string): boolean { return this.pending.has(requestId); }
  getSessionId(toolCallId: string, requestId?: string): string | null {
    if (!requestId || this.byTool.get(toolCallId) !== requestId) return null;
    return this.pending.get(requestId)?.controllerSessionId ?? null;
  }

  request(sessionId: string, workspaceId: string, root: string,
    delivery: ApplicationDeliveryPort<unknown>, signal: AbortSignal,
    childForTool?: (toolUseId: string) => string | null): CanUseTool {
    return async (toolName, input, options) => {
      const session = await getSession(sessionId);
      if (signal.aborted || options.signal.aborted || session?.harness !== 'claude-cli'
        || session.workspaceId !== workspaceId) return denied('Claude tool request is no longer active');
      if (options.blockedPath) return denied('Claude tool path is blocked');
      if (!toolName || toolName.length > 256 || !input || typeof input !== 'object' || Array.isArray(input)) {
        return denied('Malformed Claude tool');
      }
      // The in-process Prokop tools carry their own per-mode ask inside their
      // handler; the SDK gate only re-checks registration-time availability.
      if (toolName === 'mcp__prokop__memory' || toolName === 'mcp__prokop__agent_memory'
        || toolName === 'mcp__prokop__session_search' || toolName === 'mcp__prokop__agent_skill_manage') {
        if (toolName === 'mcp__prokop__memory'
          && (await getWorkspace(workspaceId))?.settings.memory?.enabled !== true) {
          return denied('Workspace memory is disabled');
        }
        if (toolName === 'mcp__prokop__session_search'
          && (await getWorkspace(workspaceId))?.settings.sessionSearch?.enabled !== true) {
          return denied('Session search is disabled');
        }
        return { behavior: 'allow' };
      }
      // Claude's question tool always waits for the human, at every permission
      // mode; the answers return to the CLI as updatedInput.
      if (toolName === CLAUDE_QUESTION_TOOL) {
        const questions = parseClaudeQuestions(input as Record<string, unknown>);
        if (!questions) return denied('Malformed Claude tool');
        if (!isControlled(sessionId)) return denied('Claude question requires a session controller');
        return this.open(sessionId, workspaceId, toolName, delivery, signal, options, childForTool,
          claudeQuestionAsk(questions), { key: null, scopes: ['once'] },
          { questions, input: input as Record<string, unknown> });
      }
      const ask = classifyClaudeTool(toolName, input as Record<string, unknown>, root,
        await sessionPermissionRoots(session, root));
      if (ask === null) return denied('Malformed Claude tool');
      // Tools without a Prokop risk rule use the SDK's native behavior, regardless of the session ceiling.
      if (ask === undefined) return { behavior: 'allow' };
      // Remembered command grants (permissions v2): consult before the mode.
      let grantKey: string | null = null;
      const grantScopes: readonly string[] = ask.allowedScopes ?? ['once'];
      if (toolName === 'Bash' && typeof input.command === 'string') {
        grantKey = JSON.stringify([root, input.command]);
        const matched = matchGrant({ workspaceId, toolName: BASH_TOOL, resource: 'shell-command',
          action: 'execute', permissionKey: grantKey, rootSessionId: sessionId });
        if (matched.matched && matched.grant && (matched.grant.scope === 'workspace'
          || matched.grant.scope === 'session' && matched.grant.boundRootSessionId === sessionId)) {
          return { behavior: 'allow' };
        }
      }
      if (shouldAutoApproveAsk(ask, session.permissionMode ?? 'standard')) return { behavior: 'allow' };
      // Nobody owns the session (scheduled or API runs): no one can answer.
      // An owner whose window is briefly offline keeps the ask, which is
      // stored and shown when they reconnect, like Codex approvals.
      if (!isControlled(sessionId)) {
        return denied('Claude tool requires a session controller');
      }
      return this.open(sessionId, workspaceId, toolName, delivery, signal, options, childForTool,
        ask, { key: grantKey, scopes: grantScopes }, null);
    };
  }

  /** Stores the ask, delivers it to the controller and waits for its answer. */
  private async open(sessionId: string, workspaceId: string, toolName: string,
    delivery: ApplicationDeliveryPort<unknown>, signal: AbortSignal,
    options: Parameters<CanUseTool>[2], childForTool: ((toolUseId: string) => string | null) | undefined,
    ask: Ask, grant: Pick<Pending, 'key' | 'scopes'>, question: PendingQuestion | null,
  ): Promise<PermissionResult> {
    const childId = options.toolUseID ? childForTool?.(options.toolUseID) : null;
    const child = childId ? await getSession(childId) : null;
    if (childId && (child?.parentId == null || child.harness !== 'claude-cli')) {
      return denied('Claude child tool identity is invalid');
    }
    const requestId = crypto.randomUUID();
    const toolCallId = `claude-approval:${crypto.randomUUID()}`;
    const timeout = this.timeoutMs();
    const now = Date.now();
    const dbId = createPendingAsk({ requestId, toolCallId, toolName: `claude-cli:${toolName}`,
      sessionId: childId ?? sessionId, rootSessionId: sessionId, workspaceId, ask,
      isPermission: !question, status: 'pending', createdAt: now, expiresAt: now + timeout });
    return new Promise<PermissionResult>(resolve => {
      const timer = setTimeout(() => this.settle(requestId,
        denied(question ? 'Claude question timed out' : 'Claude permission timed out'), true), timeout);
      this.pending.set(requestId, { sessionId: childId ?? sessionId, controllerSessionId: sessionId,
        toolCallId, dbId, timer, finish: resolve, delivery, workspaceId, ...grant, question });
      this.byTool.set(toolCallId, requestId);
      const abort = () => this.settle(requestId, denied('Claude turn interrupted'), true);
      signal.addEventListener('abort', abort, { once: true });
      options.signal.addEventListener('abort', abort, { once: true });
      try {
        const deliveredAsk = childId ? { ...ask, _originSessionId: childId } : ask;
        delivery.sendToAskTargets(sessionId, AUTHORITY, { type: 'ask.request', sessionId,
          toolCallId, toolName: `claude-cli:${toolName}`, requestId, authority: AUTHORITY,
          ask: deliveredAsk });
        if (signal.aborted || options.signal.aborted) abort();
        // Questions surface in the attention feed without a permission push,
        // like the Prokop question tool.
        else if (!question) void notifyHarnessPermissionRequired(requestId, sessionId);
      } catch { abort(); }
    });
  }

  async resolve(toolCallId: string, response: unknown, requestId?: string): Promise<boolean> {
    if (!requestId || this.byTool.get(toolCallId) !== requestId) return false;
    const pending = this.pending.get(requestId);
    if (!pending || pending.toolCallId !== toolCallId
      || (await getSession(pending.sessionId))?.harness !== 'claude-cli') return false;
    const controlled = isControlled(pending.controllerSessionId)
      && getControllerConnections(pending.controllerSessionId).length > 0;
    if (pending.question) {
      const answers = controlled ? claudeQuestionAnswers(pending.question.questions, response) : null;
      if (!resolvePermissionRequestByRequestId(requestId, answers ? 'approved' : 'denied', response)) {
        this.settle(requestId, denied('Claude question expired'), true);
        return false;
      }
      this.settle(requestId, answers ? { behavior: 'allow', updatedInput: { ...pending.question.input, answers } }
        : denied('Claude question was not answered'), false);
      return true;
    }
    const value = response && typeof response === 'object' && !Array.isArray(response)
      ? response as Record<string, unknown> : null;
    const allowed = controlled
      && value?.type === 'permission' && typeof value.grant === 'string'
      && (pending.key ? pending.scopes : ['once']).includes(value.grant)
      && value.scope === undefined && value.duration === undefined;
    // Remembered grants persist atomically with the resolution; a grant
    // failure denies the approval (never accept without its requested scope).
    let granted = true;
    if (allowed && pending.key && (value.grant === 'session' || value.grant === 'workspace')) {
      try {
        getDatabase().transaction(() => {
          createGrantFromOptions({ workspaceId: pending.workspaceId, toolName: BASH_TOOL,
            resource: 'shell-command', action: 'execute', permissionKey: pending.key!,
            grantOptions: { scope: value.grant as 'session' | 'workspace',
              matcher: 'exact', action: 'execute', patterns: [pending.key!],
              ...(value.grant === 'session' ? { boundRootSessionId: pending.controllerSessionId } : {}) } });
        })();
      } catch {
        granted = false;
      }
    }
    if (!resolvePermissionRequestByRequestId(requestId, allowed && granted ? 'approved' : 'denied', response)) {
      this.settle(requestId, denied('Claude permission expired'), true);
      return false;
    }
    this.settle(requestId, allowed && granted
      ? { behavior: 'allow' } : denied('Claude permission denied'), false);
    return true;
  }

  cancelSession(sessionId: string): void {
    for (const [id, pending] of this.pending) {
      if (pending.controllerSessionId === sessionId || pending.sessionId === sessionId) {
        this.settle(id, denied('Claude turn interrupted'), true);
      }
    }
  }

  private settle(id: string, result: PermissionResult, expired: boolean): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    this.byTool.delete(pending.toolCallId);
    clearTimeout(pending.timer);
    if (expired) expirePermissionRequest(pending.dbId);
    pending.delivery.broadcastToSession(pending.controllerSessionId, { type: 'ask.timeout',
      sessionId: pending.controllerSessionId, toolCallId: pending.toolCallId, requestId: id });
    pending.finish(result);
  }
}

export const claudeApprovals = new ClaudeApprovals();
