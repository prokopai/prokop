import type { ToolDefinition } from '@prokopai/sdk/tool'
import type { TextPart, Session, Preconfig, MessageWithParts, Part, PermissionAsk, SessionHarness, StructuredOutputData } from '@prokopai/sdk/types';
import type { HeadlessSessionRunPort } from '@prokopai/core/application/ports/headless-execution';
import type { DelegationHostPort } from '@prokopai/core/application/ports/delegation-host';
import { getSession } from '@prokopai/core/infrastructure/storage/runtime';
import {
  DEFAULT_WAIT_TIMEOUT_MS,
  getTaskRegistry,
  type TaskHandle,
  type TaskRegistry,
} from '#agent/harnesses/prokop/subagent/task-registry';
import { getPreconfig, updatePreconfig } from '@prokopai/core/infrastructure/config/preconfig';
import {
  harnessLabel,
  isSessionHarness,
  launchBranchName,
  resolveDelegationTarget,
  validateDelegationTarget,
  type DelegationCatalog,
  type DelegationFailureCode,
  type DelegationHostView,
  type DelegationTarget,
  type ResolvedDelegationTarget,
} from '#agent/harnesses/prokop/subagent/delegation';
import type { BroadcastFn, BroadcastSessionFn } from '@prokopai/core/infrastructure/runtime/host';
import type { RuntimeEvent } from '@prokopai/core/infrastructure/runtime/events';
import type { SessionUpdates } from '@prokopai/core/infrastructure/storage/contracts';
import { resolveModelId, resolveProviderId } from '@prokopai/core/infrastructure/providers/model-selection';
import {
  collectSubagentAncestry,
  evaluateSubagentTarget,
  getSubagentResumeError,
  isSubagentSpawningDisabled,
  isValidSubagentTargetPreconfig,
} from '#agent/harnesses/prokop/subagent/policy';

import { randomUUID } from 'crypto';

/** Subagent domain: the delegation service behind `delegate_task`, `task_status`
 * and `task_cancel` on every harness. Every child runs through the host's
 * harness dispatch (`runOnHarness`) and its answer is read back from its
 * transcript; the service runs against injected session, preconfig and
 * broadcast dependencies (`executeSubagentWithDeps`). */

const MAX_SUBAGENT_DEPTH = 2;

export interface SubagentInput {
  description: string;
  prompt: string;
  /** The role. Required; refused with `invalid_request` when missing. */
  subagent_type?: string;
  /** Overrides the role's default harness, model, provider or variant for this task. */
  target?: DelegationTarget;
  /** `wait` (default) returns the result; `async` returns at once and the result arrives as a message. */
  mode?: 'wait' | 'async';
  /** Wait only. On expiry the task turns async; it is never cancelled. */
  timeoutMs?: number;
  /** Stable per logical task: a retried call returns the same task instead of a second child. */
  clientRequestId?: string;
  /**
   * `worktree`: not a subagent but a top-level session on its own branch and
   * managed worktree, async, linked to the caller only through the task row.
   */
  /** worktree: a top-level session in a new branch and worktree. checkout: a top-level session in the current checkout. Absent: a subagent. */
  isolation?: 'worktree' | 'checkout';
  /** Branch the launch's branch starts from; default the workspace's current branch. */
  baseBranch?: string;
  /** Asks the user when policy says so (a free target, a launch); absent means those are refused. */
  ask?: DelegationAsk;
  task_id?: string;
  sessionId: string;
  workspaceId?: string;
  workspacePath?: string;
  abortSignal?: AbortSignal;
  allowedSubagentIds?: string[];
  broadcastSessionCreated?: BroadcastSessionFn;
  broadcastSessionUpdated?: BroadcastSessionFn;
  /** Optional JSON Schema for structured subagent output */
  outputSchema?: Record<string, unknown>;
}

/** The user's answer to a delegation ask: approved, and whether to remember it for the agent. */
export type DelegationAsk = (ask: PermissionAsk) => Promise<{ approved: boolean; remember?: boolean }>;

/** A permission ask's answer, as the Prokop ask API returns it, read as a decision. */
export function delegationDecision(answer: unknown): { approved: boolean; remember: boolean } {
  if (!answer) return { approved: false, remember: false };
  if (typeof answer !== 'object') return { approved: true, remember: false };
  const value = answer as Record<string, unknown>;
  const grant = value.grant;
  if (value.approved === false || value.decision === 'decline' || value.behavior === 'deny' || grant === 'deny') return { approved: false, remember: false };
  return { approved: true, remember: grant === 'session' || grant === 'workspace' || value.remember === true };
}

export interface SubagentOutput {
  task_id: string;
  result: string;
  error?: string;
  /** Why the delegation was refused, when it was. */
  code?: DelegationFailureCode;
  /** Structured JSON result when outputSchema was provided */
  structuredResult?: Record<string, unknown>;
  /** Present when the call returned before the child finished. */
  status?: 'running';
  harness?: SessionHarness;
  model?: string | null;
  waitTimedOut?: boolean;
  /** The child is blocked on a question or approval the user sees on this session. */
  pendingAsk?: boolean;
}

export interface SubagentServiceSessionAccess {
  getSession(id: string): Session | null | Promise<Session | null>;
  createSession(session: Omit<Session, 'createdAt' | 'updatedAt'> & { createdAt?: string; updatedAt?: string }): Session | Promise<Session>;
  updateSession(id: string, updates: SessionUpdates): Session | null | Promise<Session | null>;
  getWorkspaceAutoApproveSeverity(workspaceId: string): Promise<Session['autoApproveSeverity']>;
  /** Direct children, for the running-children limit. Absent: no limit is enforced. */
  listChildSessions?(parentId: string): Session[] | Promise<Session[]>;
}

export interface SubagentServicePreconfigs {
  getPreconfigOrAgent(id: string): Promise<Preconfig | null>;
  listSubagentPreconfigs(): Promise<Preconfig[]>;
  /** "Allow for this agent": the harness joins the agent's delegation targets. */
  allowDelegationTarget?(preconfigId: string, harness: SessionHarness): Promise<void>;
}

export interface SubagentServiceBroadcasts {
  event: BroadcastFn;
  sessionCreated: BroadcastSessionFn;
  sessionUpdated: BroadcastSessionFn;
  toSession: (sessionId: string, event: RuntimeEvent) => void;
}

export interface SubagentServiceDeps {
  sessionAccess: SubagentServiceSessionAccess;
  preconfigs: SubagentServicePreconfigs;
  broadcasts: SubagentServiceBroadcasts;
  /**
   * Every child, on any harness, runs through the host's harness dispatch,
   * visibly, and its result is read back from its transcript. Absent: a
   * delegation is refused.
   */
  runOnHarness?: HeadlessSessionRunPort['run'];
  readTranscript?: (sessionId: string) => Promise<MessageWithParts[]>;
  /** Harness enabled and installed checks (plus asks, interrupts, task rows and worktrees); absent means everything is allowed, nothing persisted. */
  host?: DelegationHostView & Partial<Pick<DelegationHostPort, 'hasPendingAsk' | 'interrupt' | 'tasks' | 'worktrees' | 'maxLaunches'>>;
  /** Model catalogs for validating an explicit target. */
  catalog?: DelegationCatalog;
  /** Running children allowed per root session. */
  maxChildren?: () => number;
  /** Tracks tasks after the parent stops waiting; default: the shared registry. */
  registry?: TaskRegistry;
}

export type TaskLifecycleStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';

export interface TaskStatusOutput {
  task_id: string;
  status: TaskLifecycleStatus;
  harness: SessionHarness;
  model: string | null;
  /** The child's last answer once it is no longer running. */
  result: string | null;
  pendingAsk: boolean;
  error?: string;
  code?: DelegationFailureCode;
}

function lifecycleStatus(session: Session): TaskLifecycleStatus {
  switch (session.subagentStatus) {
    case 'running': return 'running';
    case 'completed': return 'completed';
    case 'error': return 'failed';
    case 'interrupted': return 'interrupted';
    default: return session.runningAt ? 'running' : 'completed';
  }
}

/** The child when it belongs to the caller's subtree or was launched by the caller, else a typed refusal. */
async function ownedChild(
  taskId: string,
  callerSessionId: string,
  getSessionFn: (id: string) => Session | null | Promise<Session | null>,
  tasks?: DelegationHostPort['tasks'],
): Promise<{ ok: true; child: Session } | { ok: false; code: DelegationFailureCode; error: string }> {
  const child = await getSessionFn(taskId);
  if (child && tasks?.get(taskId)?.parentSessionId === callerSessionId) return { ok: true, child };
  if (!child || !child.parentId) return { ok: false, code: 'task_not_found', error: `No task with id "${taskId}"` };
  let current: string | null = child.parentId;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    if (current === callerSessionId) return { ok: true, child };
    seen.add(current);
    current = (await getSessionFn(current))?.parentId ?? null;
  }
  return { ok: false, code: 'task_not_found', error: `Task "${taskId}" does not belong to this session` };
}

/** `task_status`: where a child stands and, once settled, its last answer. */
export async function executeTaskStatus(
  input: { task_id: string; sessionId: string },
  deps: Pick<SubagentServiceDeps, 'sessionAccess' | 'readTranscript' | 'host'>,
): Promise<TaskStatusOutput> {
  const owned = await ownedChild(input.task_id, input.sessionId, deps.sessionAccess.getSession, deps.host?.tasks);
  if (!owned.ok) {
    return { task_id: input.task_id, status: 'failed', harness: 'prokop', model: null, result: null, pendingAsk: false, error: owned.error, code: owned.code };
  }
  const status = lifecycleStatus(owned.child);
  const result = status === 'running' || !deps.readTranscript ? null : lastAssistantText(await deps.readTranscript(owned.child.id)) || null;
  return {
    task_id: owned.child.id,
    status,
    harness: owned.child.harness ?? 'prokop',
    model: owned.child.selectedModel ?? null,
    result,
    pendingAsk: deps.host?.hasPendingAsk?.(owned.child.id) ?? false,
  };
}

/** `task_cancel`: stops a running child; the parent is not told again. */
export async function executeTaskCancel(
  input: { task_id: string; sessionId: string },
  deps: Pick<SubagentServiceDeps, 'sessionAccess' | 'host' | 'broadcasts'>,
): Promise<{ task_id: string; status: TaskLifecycleStatus; error?: string; code?: DelegationFailureCode }> {
  const owned = await ownedChild(input.task_id, input.sessionId, deps.sessionAccess.getSession, deps.host?.tasks);
  if (!owned.ok) return { task_id: input.task_id, status: 'failed', error: owned.error, code: owned.code };
  if (lifecycleStatus(owned.child) !== 'running') return { task_id: owned.child.id, status: lifecycleStatus(owned.child) };
  await deps.host?.interrupt?.(owned.child.id, 'Cancelled by the parent session');
  const updated = await deps.sessionAccess.updateSession(owned.child.id, { subagentStatus: 'interrupted' });
  if (updated) deps.broadcasts.sessionUpdated(updated);
  return { task_id: owned.child.id, status: 'cancelled' };
}

/** Running descendants of `rootId`, the number the concurrency limit is checked against. */
export async function countRunningDescendants(
  rootId: string,
  listChildSessions: NonNullable<SubagentServiceSessionAccess['listChildSessions']>,
): Promise<number> {
  let count = 0;
  const pending = [rootId];
  const seen = new Set<string>();
  while (pending.length) {
    const parentId = pending.pop()!;
    if (seen.has(parentId)) continue;
    seen.add(parentId);
    for (const child of await listChildSessions(parentId)) {
      if (child.subagentStatus === 'running') count += 1;
      pending.push(child.id);
    }
  }
  return count;
}

async function rootSessionId(
  sessionId: string,
  getSessionFn: (id: string) => Session | null | Promise<Session | null>,
): Promise<string> {
  let current = sessionId;
  const seen = new Set<string>();
  while (!seen.has(current)) {
    seen.add(current);
    const session = await getSessionFn(current);
    if (!session?.parentId) break;
    current = session.parentId;
  }
  return current;
}

/** "Allow for this agent": writes the harness into the preconfig's delegation targets. */
export async function rememberDelegationTarget(preconfigId: string, harness: SessionHarness): Promise<void> {
  const current = await getPreconfig(preconfigId);
  if (!current) return;
  const targets = current.delegationTargets;
  if (targets === 'any' || (Array.isArray(targets) && targets.includes(harness))) return;
  const next: SessionHarness[] = Array.isArray(targets) ? [...targets, harness] : [harness];
  await updatePreconfig(preconfigId, { delegationTargets: next });
}

/** The message the user sees when an override or a launch needs their approval. */
export function delegationAsk(input: {
  kind: 'target' | 'launch';
  description: string;
  harness: SessionHarness;
  model: string | null;
  role: string;
  branch?: string;
  baseBranch?: string;
}): PermissionAsk {
  const where = `${harnessLabel(input.harness)} with ${input.model ?? 'its default model'}`;
  const details = [
    `Task: ${input.description}`,
    `Role: ${input.role}`,
    `Harness and model: ${where}`,
    input.branch ? `Branch: ${input.branch} from ${input.baseBranch ?? 'the current branch'}` : null,
  ].filter(Boolean).join('\n');
  return input.kind === 'launch'
    ? {
        type: 'permission',
        question: input.branch
          ? `Start a session in a new worktree for "${input.description}"?`
          : `Start a new session in this checkout for "${input.description}"?`,
        description: details,
        risk: 'medium',
        action: 'launch',
        allowedScopes: ['once'],
        metadata: { delegation: 'launch', harness: input.harness, model: input.model, branch: input.branch },
      }
    : {
        type: 'permission',
        question: `Run "${input.description}" on ${where}?`,
        description: `${details}\nThis agent may not change a role's harness or model on its own. Allow for this agent remembers the harness.`,
        // Medium: the agent's "ask" setting means standard mode asks; extended and full approve on their own.
        risk: 'medium',
        action: 'delegate',
        allowedScopes: ['once', 'workspace'],
        metadata: { delegation: 'target', harness: input.harness, model: input.model },
      };
}

function readTarget(raw: unknown): DelegationTarget | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Record<string, unknown>;
  const target: DelegationTarget = {};
  if (isSessionHarness(value.harness)) target.harness = value.harness;
  for (const key of ['provider', 'model', 'variant'] as const) {
    if (typeof value[key] === 'string' && value[key]) target[key] = value[key] as string;
  }
  return Object.keys(target).length ? target : undefined;
}

export { readTarget as readDelegationTarget };

/** The harness a subagent role runs on by default; a Prokop role (or none) stays in-process. */
export function subagentHarness(preconfig: Pick<Preconfig, 'modelHarness'>): SessionHarness {
  return preconfig.modelHarness ?? 'prokop';
}

/** The task result as the parent reads it (OpenCode's task_result tags), byte for byte as before. */
export function formatTaskOutput(taskId: string, text: string, structuredResult?: Record<string, unknown>): string {
  return [
    `task_id: ${taskId} (for resuming to continue this task if needed)`,
    '',
    '<task_result>',
    text || 'No response generated',
    '</task_result>',
    structuredResult
      ? '\n<structured_result>\n' + JSON.stringify(structuredResult, null, 2) + '\n</structured_result>'
      : '',
  ].join('\n');
}

/** The last assistant text of a transcript, the same way the in-process child reports its answer. */
export function lastAssistantText(messages: MessageWithParts[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entry = messages[index]!;
    if (entry.message.role !== 'assistant') continue;
    const text = entry.parts.filter((part): part is TextPart => part.type === 'text').map((part) => part.text || '').pop();
    if (text !== undefined) return text;
  }
  return '';
}

/**
 * A CLI harness has no response-schema channel, so a structured result is
 * the final text parsed as JSON: the whole text, or its last fenced block.
 */
export function parseStructuredText(text: string): Record<string, unknown> | null {
  const candidates = [text.trim()];
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((match) => match[1]?.trim() ?? '');
  candidates.push(...fenced.reverse());
  for (const candidate of candidates) {
    if (!candidate.startsWith('{')) continue;
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // Not this one.
    }
  }
  return null;
}

/** Pure assembly of the task tool definition from a resolved target list.
 * Moved byte-for-byte from the pre-C5 `getSubagentToolDefinition` assembly. */
export function buildTaskToolDefinition(subagents: Preconfig[]): ToolDefinition {
  const agentList = subagents
    .map((a) => `- ${a.id}: ${a.description ?? 'This subagent should only be called manually by the user.'}`)
    .join('\n');

  const subagentTypeEnum = subagents.length > 0
    ? subagents.map(s => s.id)
    : [];

  return {
    name: 'task',
    description: `Launch a new agent to handle complex, multistep tasks autonomously.

Available agent types and the tools they have access to:
${agentList}

When using the Task tool, you must specify a subagent_type parameter to select which agent type to use.

Usage notes:
1. Launch multiple agents concurrently whenever possible, to maximize performance
2. The agent's outputs should generally be trusted
3. Each agent invocation starts with a fresh context unless you provide task_id to resume the same subagent session (which continues with its previous messages and tool outputs). When starting fresh, your prompt should contain a highly detailed task description for the agent to perform autonomously and you should specify exactly what information the agent should return back to you in its final and only message to you.
4. Clearly tell the agent whether you expect it to write code or just to do research (search, file reads, web fetches), since it is not aware of the user's intent. Tell it how to verify its work if possible (e.g., relevant test commands).
5. If the agent description mentions that it should be proactively used, then you should try your best to use it without the user having to ask you to do so first. Use your judgement.
6. Use the outputSchema parameter (a JSON Schema) to get structured, machine-readable output from a subagent instead of a free-text prose response. The subagent will be constrained to return JSON conforming to that schema.
7. subagent_type is always required. The role runs on its own harness and model, or on yours when it sets none. target overrides that for one task: the harness (prokop, codex-cli, claude-cli), model, provider (Prokop only) and variant or effort. Whether you may override without asking is the agent's delegation targets setting; call delegation_capabilities to see roles with their defaults, harnesses, models and that setting.
9. isolation "worktree" is for implementation work that should become its own branch: it starts a top-level session (not a subagent) in a fresh managed worktree with the repository's setup applied, always async, and the user may be asked before it starts. The finish message names the branch, the worktree and the number of changed files; the user opens that session to review and merge. Subagents never get their own worktree. isolation "checkout" also starts a top-level session, but in the current checkout, sharing the working tree, for work the user should follow as its own session.
8. mode "wait" (default) returns the result in this call. mode "async" returns at once with status "running"; the result arrives later as a new message "[task <id> ... finished]" and you continue other work meanwhile. A wait that hits timeoutMs (default 10 minutes), or a child that stops for a question or approval, also returns with status "running" and the task continues async: never poll for it, it will come to you. Use task_status for an explicit check and task_cancel to stop one. Pass a stable clientRequestId per logical task so a retried call never starts a second child.

When to use outputSchema (IMPORTANT - prefer it over free text in these cases):
- AGGREGATION: When spawning multiple parallel agents and you need to combine, filter, compare, or deduplicate their results. Define a shared schema for all agents so you can merge results programmatically.
- DATA EXTRACTION: When a subagent is searching, reading, or analyzing something and you need specific fields back (e.g., { findings: [{ file, line, issue, severity }], summary: string }).
- DECISIONS: When a subagent must return a verdict, classification, or yes/no with reasoning (e.g., { approved: boolean, concerns: string[], confidence: number }).
- LIST GENERATION: When a subagent finds or produces a list you need to iterate over (e.g., { files: string[], commands: string[] }).

When NOT to use it:
- The task is exploratory and the output shape is unpredictable (e.g., "summarize what you found about X").
- The subagent is writing code or modifying files directly — its result is the code changes, not a report.

Pattern for aggregation (map-reduce): define one schema, spawn N agents each with that outputSchema, then in your next turn merge the returned JSON objects. This keeps your context clean because you can reason about the data instead of re-parsing prose from each agent.

Note: Subagent depth is limited to 2 levels. You cannot spawn further subagents at the maximum depth.`,
    timeout: null,
    inputSchema: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'A short (3-5 words) description of the task',
        },
        prompt: {
          type: 'string',
          description:
            'The task for the agent to perform. Should contain a highly detailed task description specifying exactly what information the agent should return in its final message',
        },
        subagent_type: {
          type: 'string',
          description: 'The role (specialized agent) to run. Required.',
          ...(subagentTypeEnum.length > 0 && { enum: subagentTypeEnum }),
        },
        target: {
          type: 'object',
          description: 'Optional override of the role\'s default harness, model, provider (Prokop only) and variant or effort for this task. Omit to run the role as configured. May ask the user or be refused, per the agent\'s delegation targets setting.',
          properties: {
            harness: { type: 'string', enum: ['prokop', 'codex-cli', 'claude-cli'] },
            model: { type: 'string' },
            provider: { type: 'string' },
            variant: { type: 'string' },
          },
          additionalProperties: false,
        },
        mode: {
          type: 'string',
          enum: ['wait', 'async'],
          description: 'wait (default): return the result here. async: return now; the result arrives as a message when the task finishes.',
        },
        timeoutMs: {
          type: 'number',
          description: 'wait only: how long to wait before the task turns async (default 600000). The task is never cancelled by a timeout.',
        },
        clientRequestId: {
          type: 'string',
          description: 'Stable id for this logical task. Retrying a call with the same id returns the same task instead of starting a second child.',
        },
        isolation: {
          type: 'string',
          enum: ['worktree', 'checkout'],
          description: 'Start a top-level session instead of a subagent, always async; the user may be asked first. worktree: on its own branch and managed worktree (implementation work that becomes a branch). checkout: in the current checkout.',
        },
        baseBranch: {
          type: 'string',
          description: 'With isolation worktree: the local branch to branch from (default: the workspace\'s current branch).',
        },
        task_id: {
          type: 'string',
          description:
            'Set this to resume a previous subagent session (continues with its previous messages and tool outputs)',
        },
        outputSchema: {
          type: 'object',
          description: 'Optional JSON Schema that the subagent must conform to in its final response. Use this when you need structured, parseable output (e.g., extracted data, categorized findings, structured analysis). When omitted, the subagent returns free text.',
          additionalProperties: true,
        },
      },
      required: ['description', 'prompt', 'subagent_type'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        result: { type: 'string' },
        error: { type: 'string' },
        code: { type: 'string' },
        structuredResult: { type: 'object', additionalProperties: true },
        status: { type: 'string' },
        harness: { type: 'string' },
        model: { type: 'string' },
        waitTimedOut: { type: 'boolean' },
        pendingAsk: { type: 'boolean' },
      },
    },
  };
}

async function computeSessionDepth(sessionId: string, getSessionFn: (id: string) => Session | null | Promise<Session | null>): Promise<number> {
  return (await collectSubagentAncestry(sessionId, getSessionFn)).depth;
}

/** Unscoped depth gate: reads the module-level session accessor. */
export async function canSpawnSubagent(sessionId: string): Promise<boolean> {
  return canSpawnSubagentWithDeps(sessionId, getSession);
}

/** Composed depth gate over the captured session lookup. */
export async function canSpawnSubagentWithDeps(
  sessionId: string,
  getSessionFn: (id: string) => Session | null | Promise<Session | null>,
): Promise<boolean> {
  const depth = await computeSessionDepth(sessionId, getSessionFn);
  return depth < MAX_SUBAGENT_DEPTH;
}

/**
 * Runs the child on its own harness and reads the answer back, producing the
 * same shape as the in-process child so the result formatting is shared.
 */
async function runChildOnHarness(
  deps: SubagentServiceDeps,
  input: {
    harness: SessionHarness;
    parentSessionId: string;
    child: Session;
    preconfig: Preconfig;
    target: ResolvedDelegationTarget;
    prompt: string;
    workspacePath?: string;
    workspaceId?: string;
    resumeFromHistory: boolean;
    outputSchema?: Record<string, unknown>;
    abortSignal?: AbortSignal;
  },
): Promise<{ parts: Part[]; error?: string; structuredOutput?: StructuredOutputData }> {
  if (!deps.runOnHarness || !deps.readTranscript) {
    return { parts: [], error: `Subagent roles on ${input.harness} are not available here` };
  }
  const before = (await deps.readTranscript(input.child.id)).length;
  const run = await deps.runOnHarness({
    harness: input.harness,
    parentSessionId: input.parentSessionId,
    childSessionId: input.child.id,
    // The resolved model and variant travel on the preconfig copy: the
    // dispatcher pins them on the CLI session from there.
    preconfig: { ...input.preconfig, modelHarness: input.harness, model: input.target.modelId, variant: input.target.variant },
    prompt: input.outputSchema
      ? `${input.prompt}\n\nReply with only a JSON object matching this schema, no prose:\n${JSON.stringify(input.outputSchema)}`
      : input.prompt,
    workspacePath: input.workspacePath,
    workspaceId: input.workspaceId ?? input.child.workspaceId,
    modelId: input.target.modelId ?? '',
    providerId: input.target.providerId ?? '',
    resumeFromHistory: input.resumeFromHistory,
  }, { visible: true, signal: input.abortSignal });
  const messages = (await deps.readTranscript(input.child.id)).slice(before);
  const text = lastAssistantText(messages);
  const parts: Part[] = text
    ? [{ id: randomUUID(), messageId: '', createdAt: Date.now(), type: 'text', text } as TextPart]
    : [];
  let structuredOutput: StructuredOutputData | undefined;
  let error = run.error;
  if (input.outputSchema && text) {
    const data = parseStructuredText(text);
    if (data) structuredOutput = { data } as StructuredOutputData;
    else error ??= 'The subagent did not return JSON matching the requested schema';
  }
  return { parts, error, ...(structuredOutput ? { structuredOutput } : {}) };
}

/** Composed execution over the dependencies captured by the domain plugin. */
export async function executeSubagentWithDeps(
  input: SubagentInput,
  deps: SubagentServiceDeps,
): Promise<SubagentOutput> {
  return runSubagent(input, deps);
}

async function runSubagent(
  input: SubagentInput,
  deps: SubagentServiceDeps,
): Promise<SubagentOutput> {
  const {
    description,
    prompt,
    subagent_type,
    target,
    mode: requestedMode = 'wait',
    timeoutMs,
    clientRequestId,
    isolation,
    baseBranch,
    ask,
    task_id,
    sessionId,
    workspaceId,
    workspacePath,
    abortSignal,
    allowedSubagentIds,
    broadcastSessionCreated: broadcastSessCreated = deps.broadcasts.sessionCreated,
    broadcastSessionUpdated: broadcastSessUpdated = deps.broadcasts.sessionUpdated,
    outputSchema,
  } = input;

  const getSessionFn = deps.sessionAccess.getSession;
  const getPreconfigOrAgentFn = deps.preconfigs.getPreconfigOrAgent;
  const listSubagentPreconfigsFn = deps.preconfigs.listSubagentPreconfigs;
  const createSessionFn = deps.sessionAccess.createSession;
  const updateSessionFn = deps.sessionAccess.updateSession;
  const getWorkspaceAutoApproveSeverityFn = deps.sessionAccess.getWorkspaceAutoApproveSeverity;

  // Check if already aborted before starting
  if (abortSignal?.aborted) {
    return {
      task_id: '',
      result: '',
      error: 'Subagent execution aborted before start',
    };
  }

  // Get parent session for model inheritance
  const parentSession = await getSessionFn(sessionId);

  // A retried call for the same logical task returns the task it already
  // started: running as `running`, settled with its result.
  const tasks = deps.host?.tasks;
  if (clientRequestId && tasks) {
    const existing = tasks.findByRequest(sessionId, clientRequestId);
    const existingChild = existing ? await getSessionFn(existing.taskId) : null;
    if (existing && existingChild) {
      if (lifecycleStatus(existingChild) === 'running') {
        return {
          task_id: existing.taskId,
          status: 'running',
          harness: existing.harness,
          model: existing.model,
          waitTimedOut: false,
          pendingAsk: deps.host?.hasPendingAsk?.(existing.taskId) ?? false,
          result: `task_id: ${existing.taskId} is already running for this request. Its result arrives as a new message when it finishes; do not start it again.`,
        };
      }
      const text = deps.readTranscript ? lastAssistantText(await deps.readTranscript(existing.taskId)) : '';
      return { task_id: existing.taskId, result: formatTaskOutput(existing.taskId, text) };
    }
  }

  const parentPreconfig = parentSession?.preconfigId
    ? await getPreconfigOrAgentFn(parentSession.preconfigId)
    : null;

  // Check depth limit
  const currentDepth = await computeSessionDepth(sessionId, getSessionFn);
  if (currentDepth >= MAX_SUBAGENT_DEPTH) {
    return {
      task_id: '',
      result: '',
      error: `Maximum subagent depth (${MAX_SUBAGENT_DEPTH}) reached. Cannot spawn more subagents.`,
      code: 'depth_exceeded',
    };
  }

  if (parentPreconfig && isSubagentSpawningDisabled(parentPreconfig.canSpawnSubagents)) {
    return {
      task_id: '',
      result: '',
      error: 'Subagent spawning is disabled for this agent.',
      code: 'subagent_not_allowed',
    };
  }

  // Every delegation names a role; a target only changes where it runs.
  if (!subagent_type) {
    return {
      task_id: '',
      result: '',
      error: 'Name a subagent_type (a role). A target only overrides the role\'s harness or model; it does not replace the role.',
      code: 'invalid_request',
    };
  }
  const roleId = subagent_type;
  const launching = isolation === 'worktree' || isolation === 'checkout';
  // The caller's own role, for a subagent or a launch alike, only with allowSelfAsSubagent.
  const selfAllowed = parentPreconfig?.allowSelfAsSubagent === true;

  {
    // Validate subagent_type against the effective allowed list
    const configuredAllowedIds = Array.isArray(parentPreconfig?.canSpawnSubagents)
      ? [...parentPreconfig.canSpawnSubagents]
      : allowedSubagentIds ? [...allowedSubagentIds] : undefined;
    if (parentSession?.preconfigId && selfAllowed) {
      configuredAllowedIds?.push(parentSession.preconfigId);
    }
    if (configuredAllowedIds && !configuredAllowedIds.includes(subagent_type)) {
      return {
        task_id: '',
        result: '',
        error: `Subagent type "${subagent_type}" is not allowed for this agent. Allowed types: ${configuredAllowedIds.join(', ')}`,
        code: 'subagent_not_allowed',
      };
    }

    const ancestry = await collectSubagentAncestry(sessionId, getSessionFn);
    const policy = evaluateSubagentTarget({
      targetPreconfigId: subagent_type,
      currentPreconfigId: parentSession?.preconfigId ?? null,
      ancestryPreconfigIds: ancestry.preconfigIds,
      allowSelfAsSubagent: selfAllowed,
    });
    if (!policy.allowed) {
      return {
        task_id: '',
        result: '',
        error: policy.error,
        code: 'subagent_not_allowed',
      };
    }
  }

  let childSession: Session | undefined | null;
  let resumeFromHistory = false;

  // Set up abort handling variables outside try block for finally access
  let wasAborted = false;
  const abortHandler = () => {
    wasAborted = true;
    if (childSession) {
      void (async () => {
        await updateSessionFn(childSession!.id, { subagentStatus: 'interrupted' });
        const updatedSession = await getSessionFn(childSession!.id);
        if (updatedSession) {
          broadcastSessUpdated(updatedSession);
        }
      })().catch((err: unknown) => {
        console.error('[executeSubagent] Failed to persist abort status', err);
      });
    }
  };

  try {
    const subagentPreconfig = await getPreconfigOrAgentFn(subagent_type);
    if (!subagentPreconfig) {
      const available = await listSubagentPreconfigsFn();
      const availableNames = available.map((s) => s.id).join(', ');
      return {
        task_id: '',
        result: '',
        error: `Unknown subagent type: "${subagent_type}". Available subagents: ${availableNames || 'none'}`,
        code: 'invalid_request',
      };
    }

    if (!isValidSubagentTargetPreconfig(
      subagentPreconfig,
      parentSession?.preconfigId ?? null,
      selfAllowed,
    )) {
      return {
        task_id: '',
        result: '',
        error: `Preconfig "${subagent_type}" cannot be used as a subagent.`,
        code: 'subagent_not_allowed',
      };
    }

    // The parent's actual model, by the main chat's fallback chain
    // (session > parent preconfig > config default); resolved only once the
    // request is valid, since it reads the models catalog.
    const parentModelId = resolveModelId(parentSession, parentPreconfig);
    const parentProviderId = resolveProviderId(parentSession, parentPreconfig);
    // Where the child runs: the role's own harness and model (the parent's
    // when it sets none), changed by the target where the parent may.
    const resolution = resolveDelegationTarget({
      role: subagentPreconfig,
      target,
      inherited: {
        harness: parentSession?.harness ?? 'prokop',
        modelId: parentModelId,
        providerId: parentProviderId,
        variant: parentSession?.selectedVariant ?? null,
      },
      parentPreconfig,
    });
    if (!resolution.ok) {
      return { task_id: '', result: '', error: resolution.error, code: resolution.code };
    }
    const resolved = resolution.target;
    const harness = resolved.harness;
    // A launch is a top-level run and never waits.
    const mode = launching ? 'async' : requestedMode;

    // An override the agent may not make on its own: the user decides.
    if (resolution.needsApproval) {
      if (!ask) {
        return {
          task_id: '',
          result: '',
          error: `This agent needs the user's approval to run on ${harnessLabel(harness)}, and nobody can be asked here. Use a role instead.`,
          code: 'target_not_allowed',
        };
      }
      const decision = await ask(delegationAsk({ kind: 'target', description, harness, model: resolved.modelId, role: subagent_type }));
      if (!decision.approved) {
        return { task_id: '', result: '', error: `The user declined running "${description}" on ${harnessLabel(harness)}.`, code: 'target_not_allowed' };
      }
      if (decision.remember && parentPreconfig) {
        await deps.preconfigs.allowDelegationTarget?.(parentPreconfig.id, harness).catch(() => undefined);
      }
    }
    // A model the agent chose itself is checked against the host; a role's
    // own was checked when the role was saved, an inherited one is in use.
    if (deps.host || resolution.source === 'target') {
      const valid = await validateDelegationTarget(
        resolution.source === 'target' ? resolved : { ...resolved, modelId: null },
        deps.host ?? { harnessEnabled: () => true, harnessAvailable: () => true },
        deps.catalog ?? { prokopModels: () => [], harnessModels: async () => [] },
      );
      if (!valid.ok) return { task_id: '', result: '', error: valid.error, code: valid.code };
    }

    if (task_id) {
      childSession = await getSessionFn(task_id);
      if (!childSession) {
        childSession = null;
      } else {
        const resumeError = getSubagentResumeError(childSession, sessionId, roleId);
        if (resumeError) {
          return {
            task_id: '',
            result: '',
            error: resumeError,
            code: 'task_not_found',
          };
        }

        resumeFromHistory = true;
        await updateSessionFn(childSession.id, { subagentStatus: 'running' });
      }
    }

    if (childSession && (childSession.harness ?? 'prokop') !== harness) {
      return {
        task_id: '',
        result: '',
        error: `Invalid task_id: the subagent runs on ${childSession.harness ?? 'prokop'}, not ${harness}`,
        code: 'task_not_found',
      };
    }

    let launch: { worktreeId: string | null; path: string | null; branch: string | null } | null = null;
    if (!childSession && launching) {
      const intoWorktree = isolation === 'worktree';
      const worktrees = deps.host?.worktrees;
      if (intoWorktree && !worktrees) {
        return { task_id: '', result: '', error: 'This host cannot create worktrees, so nothing can be launched here.', code: 'invalid_request' };
      }
      const policy = parentPreconfig?.launches ?? 'ask';
      if (policy === 'never') {
        return { task_id: '', result: '', error: 'This agent may not start top-level sessions.', code: 'launch_not_allowed' };
      }
      // Running launches under this orchestrator, however they were started.
      const limit = deps.host?.maxLaunches?.() ?? 3;
      const rows = (deps.host?.tasks?.listByParent(sessionId) ?? []).filter((row) => row.kind === 'launch');
      let running = 0;
      for (const row of rows) {
        const launched = await getSessionFn(row.taskId);
        if (launched && lifecycleStatus(launched) === 'running') running += 1;
      }
      if (running >= limit) {
        return {
          task_id: '',
          result: '',
          error: `${running} launched sessions are already running from this session (limit ${limit}). Wait for one to finish.`,
          code: 'concurrency_limit',
        };
      }
      const workspaceIdForLaunch = workspaceId || parentSession?.workspaceId || '';
      let base: string | null = null;
      let branchName: string | null = null;
      if (intoWorktree) {
        base = baseBranch ?? await worktrees!.currentBranch(workspaceIdForLaunch);
        if (!base) {
          return { task_id: '', result: '', error: 'The workspace is not on a Git branch; nothing to branch from.', code: 'invalid_request' };
        }
        branchName = launchBranchName(description);
      }
      if (policy === 'ask') {
        if (!ask) {
          return { task_id: '', result: '', error: "Starting a top-level session needs the user's approval, and nobody can be asked here.", code: 'launch_not_allowed' };
        }
        const decision = await ask(delegationAsk({
          kind: 'launch', description, harness, model: resolved.modelId, role: subagent_type,
          ...(branchName && base ? { branch: branchName, baseBranch: base } : {}),
        }));
        if (!decision.approved) {
          return { task_id: '', result: '', error: `The user declined starting a ${intoWorktree ? 'worktree ' : ''}session for "${description}".`, code: 'launch_not_allowed' };
        }
      }
      if (intoWorktree) {
        const created = await worktrees!.createWorktree({ workspaceId: workspaceIdForLaunch, branch: branchName!, baseBranch: base! });
        if (!created.ok) {
          return { task_id: '', result: '', error: `Could not create the worktree: ${created.error}`, code: 'invalid_request' };
        }
        launch = { worktreeId: created.worktreeId, path: created.path, branch: created.branch };
      } else {
        // The current checkout: the new session shares the parent's root and working tree.
        launch = { worktreeId: null, path: null, branch: null };
      }

      childSession = await createSessionFn({
        id: randomUUID(),
        workspaceId: workspaceIdForLaunch,
        workspaceRootId: launch.worktreeId ?? parentSession?.workspaceRootId ?? null,
        preconfigId: roleId,
        title: description,
        status: 'active',
        metadata: null,
        parentId: null,
        agentName: null,
        subagentStatus: 'running',
        ...(harness !== 'prokop' ? { harness } : {}),
        selectedModel: resolved.modelId,
        selectedProvider: resolved.providerId,
        selectedVariant: resolved.variant,
        permissionMode: parentSession?.permissionMode ?? null,
        autoApproveSeverity: await getWorkspaceAutoApproveSeverityFn(workspaceIdForLaunch),
      });
      broadcastSessCreated(childSession);
    }

    if (!childSession) {
      // At most N running children per root, however deep they sit.
      if (deps.sessionAccess.listChildSessions && deps.maxChildren) {
        const limit = deps.maxChildren();
        const root = await rootSessionId(sessionId, getSessionFn);
        const running = await countRunningDescendants(root, deps.sessionAccess.listChildSessions);
        if (running >= limit) {
          return {
            task_id: '',
            result: '',
            error: `${running} subagents are already running under this session (limit ${limit}). Wait for one to finish.`,
            code: 'concurrency_limit',
          };
        }
      }

      childSession = await createSessionFn({
        id: randomUUID(),
        workspaceId: workspaceId || parentSession?.workspaceId || '',
        workspaceRootId: parentSession?.workspaceRootId ?? null,
        preconfigId: roleId,
        title: `${description} (@${roleId} subagent)`,
        status: 'active',
        metadata: null,
        parentId: sessionId,
        agentName: roleId,
        subagentStatus: 'running',
        ...(harness !== 'prokop' ? { harness } : {}),
        selectedModel: resolved.modelId,
        selectedProvider: resolved.providerId,
        selectedVariant: resolved.variant,
        // The child never widens what the parent may do.
        permissionMode: parentSession?.permissionMode ?? null,
        autoApproveSeverity: await getWorkspaceAutoApproveSeverityFn(workspaceId || ''),
      });

      broadcastSessCreated(childSession);
    }

    // Add abort listener to update child session status if parent aborts
    if (abortSignal) {
      abortSignal.addEventListener('abort', abortHandler);
    }


    const child = childSession;
    // The durable row: a new child starts at run 1, a resumed one counts up.
    const previous = tasks?.get(child.id);
    const taskRow = {
      taskId: child.id,
      parentSessionId: sessionId,
      kind: launch || previous?.kind === 'launch' ? 'launch' as const : 'child' as const,
      worktreeId: launch?.worktreeId ?? previous?.worktreeId ?? null,
      branch: launch?.branch ?? previous?.branch ?? null,
      requestKey: clientRequestId ?? previous?.requestKey ?? null,
      description,
      harness,
      model: resolved.modelId,
      serial: (previous?.serial ?? 0) + 1,
      watched: false,
      settled: false,
      deliveredSerial: previous?.deliveredSerial ?? 0,
      createdAt: previous?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    tasks?.upsert(taskRow);
    const markSettled = (): void => {
      const current = tasks?.get(child.id);
      if (current) tasks?.upsert({ ...current, settled: true, updatedAt: new Date().toISOString() });
    };
    // Parent aborts reach the child only while the parent waits; once the
    // task turns async it runs to completion on its own.
    const childAbort = new AbortController();
    const forwardAbort = (): void => childAbort.abort(abortSignal?.reason);
    if (abortSignal?.aborted) forwardAbort();
    else abortSignal?.addEventListener('abort', forwardAbort, { once: true });
    const detachAbort = (): void => abortSignal?.removeEventListener('abort', forwardAbort);

    const finishRun = async (): Promise<SubagentOutput> => {
    const launchNote = launch?.path
      ? `You work in a dedicated worktree at ${launch.path} on branch ${launch.branch}, created for this task. `
        + 'Commit your work on that branch when it is done; do not switch branches. '
        + `When you finish, state what you changed and whether tests ran.\n\n`
      : launch
        ? 'You run as your own top-level session in the current checkout, started by another session for this task. '
          + `When you finish, state what you changed and whether tests ran.\n\n`
        : '';
    // Every child runs through the host's harness dispatch: a tool call from
    // the workspace tool list is outside any Prokop execution scope.
    const result = await runChildOnHarness(deps, {
      harness,
      parentSessionId: sessionId,
      child,
      preconfig: subagentPreconfig,
      target: resolved,
      prompt: launchNote + prompt,
      workspacePath: launch?.path ?? workspacePath,
      workspaceId: launch ? child.workspaceId : workspaceId,
      resumeFromHistory,
      outputSchema,
      abortSignal: childAbort.signal,
    });

    // Check if was aborted during execution
    if (wasAborted) {
      return {
        task_id: child.id,
        result: '',
        error: 'Subagent execution was interrupted',
      };
    }

    // Update subagent status based on execution result
    if (result.error) {
      await updateSessionFn(child.id, { subagentStatus: 'error' });
      const updatedSession = await getSessionFn(child.id);
      if (updatedSession) {
        broadcastSessUpdated(updatedSession);
      }
    } else {
      await updateSessionFn(child.id, { subagentStatus: 'completed' });
      const updatedSession = await getSessionFn(child.id);
      if (updatedSession) {
        broadcastSessUpdated(updatedSession);
      }
    }

    // Only the child's last text part is the answer.
    const text = result.parts
      .filter((part): part is TextPart => part.type === 'text')
      .map((part) => part.text || '')
      .pop() ?? '';

    // Extract structured output if it was captured
    const structuredResult = result.structuredOutput?.data;

    // If there's an error and no text, return it directly
    if (result.error && !text) {
      return {
        task_id: child.id,
        result: '',
        error: result.error,
      };
    }

    const output = formatTaskOutput(child.id, text, structuredResult);

    return {
      task_id: child.id,
      result: output,
      ...(structuredResult ? { structuredResult } : {}),
      ...(result.error && { error: result.error }),
    };
    };

    const handle: TaskHandle = {
      taskId: child.id,
      parentSessionId: sessionId,
      description,
      harness,
      model: resolved.modelId,
      kind: taskRow.kind,
      ...(taskRow.worktreeId ? { worktreeId: taskRow.worktreeId, branch: taskRow.branch } : {}),
      run: finishRun().finally(() => {
        detachAbort();
        markSettled();
      }),
    };
    const registry = deps.registry ?? getTaskRegistry(getSessionFn);
    const accepted = (flags: { waitTimedOut: boolean; pendingAsk: boolean }): SubagentOutput => {
      detachAbort();
      registry.watch(handle);
      return {
        task_id: child.id,
        status: 'running',
        harness,
        model: resolved.modelId,
        waitTimedOut: flags.waitTimedOut,
        pendingAsk: flags.pendingAsk,
        result: `task_id: ${child.id} is running on ${harness}/${resolved.modelId ?? 'default'}`
          + (launch?.path ? ` as a top-level session in worktree ${launch.path} on branch ${launch.branch}` : launch ? ' as a top-level session in this checkout' : '') + '. '
          + 'Its result arrives as a new message when it finishes; continue other work meanwhile, do not poll.'
          + (flags.pendingAsk ? ' It is waiting for the user to answer a question or approval shown on this session.' : '')
          + (flags.waitTimedOut ? ' The wait timed out; the task was not cancelled.' : ''),
      };
    };
    if (mode === 'async') return accepted({ waitTimedOut: false, pendingAsk: false });
    const waited = await registry.wait(handle, timeoutMs && timeoutMs > 0 ? timeoutMs : DEFAULT_WAIT_TIMEOUT_MS);
    if (waited.kind === 'done') return waited.output;
    return accepted({ waitTimedOut: waited.kind === 'timeout', pendingAsk: waited.kind === 'ask' });
  } catch (err: unknown) {
    console.error('[executeSubagent] AI SDK error', {
      sessionId,
      childSessionId: childSession?.id,
      subagentType: roleId,
      rawError: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err,
    });

    if (childSession) {
      await updateSessionFn(childSession.id, { subagentStatus: abortSignal?.aborted ? 'interrupted' : 'error' });
      const updatedSession = await getSessionFn(childSession.id);
      if (updatedSession) {
        broadcastSessUpdated(updatedSession);
      }
    }
    return {
      task_id: childSession?.id ?? '',
      result: '',
      error: `Task tool error: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    if (abortSignal) {
      abortSignal.removeEventListener('abort', abortHandler);
    }
  }
}
