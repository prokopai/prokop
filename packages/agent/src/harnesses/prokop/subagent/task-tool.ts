import type { ToolDefinition } from '@prokopai/sdk/tool'
import type { TextPart, Session, ResponseFormat, Preconfig, MessageWithParts, Part, SessionHarness, StructuredOutputData } from '@prokopai/sdk/types';
import {
  emitRuntimeEvent,
  emitSessionCreated,
  emitSessionUpdated,
  emitToSession,
} from '@prokopai/core/infrastructure/runtime/host-dependencies';
import { getHeadlessExecutionPort, type HeadlessSessionRunPort } from '@prokopai/core/application/ports/headless-execution';
import { delegationHost } from '@prokopai/core/application/ports/delegation-host';
import { harnessProbes } from '@prokopai/core/application/ports/harness-probes';
import { getModelsConfig } from '@prokopai/core/config';
import { getDelegationMaxChildren } from '@prokopai/core/infrastructure/runtime/environment';
import { getPreconfigOrAgent, listSubagentPreconfigs } from '#agent/harnesses/prokop/context/sources';
import {
  createSession,
  getChildSessions,
  getSession,
  getWorkspaceAutoApproveSeverity,
  listMessagesWithParts,
  updateSession,
} from '@prokopai/core/infrastructure/storage/runtime';
import {
  DEFAULT_WAIT_TIMEOUT_MS,
  getTaskRegistry,
  type TaskHandle,
  type TaskRegistry,
} from '#agent/harnesses/prokop/subagent/task-registry';
import {
  isSessionHarness,
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
import { executeChildSession } from '#agent/harnesses/prokop/subagent/child-session';
import { resolveModelId, resolveProviderId } from '@prokopai/core/infrastructure/providers/model-selection';
import {
  collectSubagentAncestry,
  evaluateSubagentTarget,
  getSubagentResumeError,
  isSubagentSpawningDisabled,
  isValidSubagentTargetPreconfig,
  resolveEffectiveSubagentTargets,
  type ResolveSubagentTargetsOptions,
} from '#agent/harnesses/prokop/subagent/policy';

import { randomUUID } from 'crypto';

/** Subagent domain: the task tool definition and execution. The unscoped
 * exports (`getSubagentToolDefinition`, `executeSubagent`,
 * `canSpawnSubagent`) keep the pre-C5 module-accessor behavior; the WithDeps
 * variants run against injected session, preconfig, broadcast, and child
 * execution dependencies captured by the domain plugin at composition. */

const MAX_SUBAGENT_DEPTH = 2;

export interface SubagentInput {
  description: string;
  prompt: string;
  /** A role. Optional when `target` names where the child runs. */
  subagent_type?: string;
  /** Where the child runs when the role does not pin it, or with no role at all. */
  target?: DelegationTarget;
  /** `wait` (default) returns the result; `async` returns at once and the result arrives as a message. */
  mode?: 'wait' | 'async';
  /** Wait only. On expiry the task turns async; it is never cancelled. */
  timeoutMs?: number;
  task_id?: string;
  sessionId: string;
  workspaceId?: string;
  workspacePath?: string;
  abortSignal?: AbortSignal;
  onSessionCreated?: (childSessionId: string) => void | Promise<void>;
  allowedSubagentIds?: string[];
  broadcast?: BroadcastFn;
  broadcastSessionCreated?: BroadcastSessionFn;
  broadcastSessionUpdated?: BroadcastSessionFn;
  broadcastToSession?: BroadcastFn;
  /** Optional JSON Schema for structured subagent output */
  outputSchema?: Record<string, unknown>;
  executeChild?: typeof executeChildSession;
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
  executeChild: typeof executeChildSession;
  /**
   * A child on another harness (a role pinned to Claude CLI or Codex CLI)
   * runs through the host's harness dispatch, visibly, and its result is
   * read back from its transcript. Absent: such roles are refused.
   */
  runOnHarness?: HeadlessSessionRunPort['run'];
  readTranscript?: (sessionId: string) => Promise<MessageWithParts[]>;
  /** Harness enabled and installed checks; absent means everything is allowed. */
  host?: DelegationHostView;
  /** Model catalogs for validating an explicit target. */
  catalog?: DelegationCatalog;
  /** Running children allowed per root session. */
  maxChildren?: () => number;
  /** Tracks tasks after the parent stops waiting; default: the shared registry. */
  registry?: TaskRegistry;
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

function moduleCatalog(): DelegationCatalog {
  return {
    prokopModels: () => getModelsConfig().providers.flatMap((provider) =>
      provider.models.map((model) => ({ id: model.id, name: model.name, providerId: provider.id }))),
    harnessModels: (harness) => harnessProbes().models(harness),
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

/** The harness a subagent role runs on; a Prokop role (or no pin) stays in-process. */
export function subagentHarness(preconfig: Pick<Preconfig, 'modelHarness'>): SessionHarness {
  return preconfig.modelHarness ?? 'prokop';
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
7. A role pinned to a harness or model always runs there; a target cannot change it. A role without a pin, or no role at all (then the child uses your own role), may take a target: the harness (prokop, codex-cli, claude-cli) and model to run on. Call delegation_capabilities to see roles, harnesses, models and what you may target.
8. mode "wait" (default) returns the result in this call. mode "async" returns at once with status "running"; the result arrives later as a new message "[task <id> ... finished]" and you continue other work meanwhile. A wait that hits timeoutMs (default 10 minutes), or a child that stops for a question or approval, also returns with status "running" and the task continues async: never poll for it, it will come to you. Use task_status for an explicit check and task_cancel to stop one.

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
          description: 'The type of specialized agent to use for this agent. Omit only when target names where to run; the child then uses your own role.',
          ...(subagentTypeEnum.length > 0 && { enum: subagentTypeEnum }),
        },
        target: {
          type: 'object',
          description: 'Where the child runs when the role does not pin it: a harness and, optionally, a model, provider (Prokop only) and variant or effort. Refused when it contradicts the role\'s pin or your allowed targets.',
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
      required: ['description', 'prompt'],
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

export interface GetSubagentToolDefinitionOptions {
  sessionId: string;
  canSpawnSubagents: boolean | string[] | null | undefined;
  allowSelfAsSubagent?: boolean;
}

/** Unscoped definition resolution: reads the module-level session and
 * preconfig accessors exactly like the pre-C5 path. */
export async function getSubagentToolDefinition(
  options: GetSubagentToolDefinitionOptions,
): Promise<ToolDefinition | null> {
  return resolveTaskToolDefinitionWithDeps(options, {
    getSession,
    listPreconfigs: listSubagentPreconfigs,
  });
}

/** Composed definition resolution over injected lookups. */
export async function resolveTaskToolDefinitionWithDeps(
  options: GetSubagentToolDefinitionOptions,
  deps: { getSession: (id: string) => Promise<Session | null>; listPreconfigs: () => Promise<Preconfig[]> },
): Promise<ToolDefinition | null> {
  const subagents = await resolveEffectiveSubagentTargets({
    sessionId: options.sessionId,
    canSpawnSubagents: options.canSpawnSubagents,
    allowSelfAsSubagent: options.allowSelfAsSubagent,
    maximumDepthReached: !(await canSpawnSubagentWithDeps(options.sessionId, deps.getSession)),
  } as ResolveSubagentTargetsOptions, deps);

  if (subagents.length === 0) return null;

  return buildTaskToolDefinition(subagents);
}

function moduleServiceDeps(): SubagentServiceDeps {
  return {
    sessionAccess: {
      getSession,
      createSession,
      updateSession,
      getWorkspaceAutoApproveSeverity,
      listChildSessions: getChildSessions,
    },
    host: delegationHost(),
    catalog: moduleCatalog(),
    maxChildren: getDelegationMaxChildren,
    preconfigs: {
      getPreconfigOrAgent,
      listSubagentPreconfigs,
    },
    broadcasts: {
      event: emitRuntimeEvent,
      sessionCreated: emitSessionCreated,
      sessionUpdated: emitSessionUpdated,
      toSession: (sessionId, event) => emitToSession(sessionId, event),
    },
    executeChild: executeChildSession,
    runOnHarness: (input, options) => {
      const port = getHeadlessExecutionPort();
      return port ? port.run(input, options) : Promise.resolve({ error: 'Harness dispatch is unavailable' });
    },
    readTranscript: (sessionId) => listMessagesWithParts(sessionId),
  };
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

/** Unscoped execution: keeps the pre-C5 module-accessor behavior and the
 * `executeChild` override seam. */
export async function executeSubagent(input: SubagentInput): Promise<SubagentOutput> {
  return runSubagent(input, moduleServiceDeps());
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
    mode = 'wait',
    timeoutMs,
    task_id,
    sessionId,
    workspaceId,
    workspacePath,
    abortSignal,
    onSessionCreated,
    allowedSubagentIds,
    broadcast: broadcastFn = deps.broadcasts.event,
    broadcastSessionCreated: broadcastSessCreated = deps.broadcasts.sessionCreated,
    broadcastSessionUpdated: broadcastSessUpdated = deps.broadcasts.sessionUpdated,
    broadcastToSession: broadcastToSessionFn,
    outputSchema,
    executeChild = deps.executeChild,
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

  // Resolve parent's actual model using same fallback chain as main chat:
  // session > parent preconfig > config default
  const parentPreconfig = parentSession?.preconfigId
    ? await getPreconfigOrAgentFn(parentSession.preconfigId)
    : null;
  const parentModelId = resolveModelId(parentSession, parentPreconfig);
  const parentProviderId = resolveProviderId(parentSession, parentPreconfig);

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

  // No role: the child is a copy of the parent's own role on an explicit
  // target, governed by the parent's allowed targets rather than by the
  // subagent allow-list (the plan's "pure parallelism" case).
  const roleId = subagent_type ?? parentSession?.preconfigId ?? null;
  if (!subagent_type && (!target || !parentPreconfig || !roleId)) {
    return {
      task_id: '',
      result: '',
      error: 'Name a subagent_type (a role) or a target harness or model.',
      code: 'invalid_request',
    };
  }

  if (subagent_type) {
    // Validate subagent_type against the effective allowed list
    const configuredAllowedIds = Array.isArray(parentPreconfig?.canSpawnSubagents)
      ? [...parentPreconfig.canSpawnSubagents]
      : allowedSubagentIds ? [...allowedSubagentIds] : undefined;
    if (parentSession?.preconfigId && parentPreconfig?.allowSelfAsSubagent) {
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
      allowSelfAsSubagent: parentPreconfig?.allowSelfAsSubagent === true,
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
    const subagentPreconfig = subagent_type
      ? await getPreconfigOrAgentFn(subagent_type)
      : parentPreconfig;
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

    if (subagent_type && !isValidSubagentTargetPreconfig(
      subagentPreconfig,
      parentSession?.preconfigId ?? null,
      parentPreconfig?.allowSelfAsSubagent === true,
    )) {
      return {
        task_id: '',
        result: '',
        error: `Preconfig "${subagent_type}" cannot be used as a subagent.`,
        code: 'subagent_not_allowed',
      };
    }

    // Where the child runs: the role's pin, then the explicit target, then
    // the parent's own harness and model. Pins are the user's routing rule.
    const resolution = resolveDelegationTarget({
      role: subagent_type ? subagentPreconfig : null,
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
    const crossHarness = harness !== 'prokop';
    // A model the model chose itself is checked against the host; a pin was
    // checked when the role was saved, an inherited one is already in use.
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
        const resumeError = getSubagentResumeError(childSession, sessionId, roleId!);
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
        ...(crossHarness ? { harness } : {}),
        selectedModel: resolved.modelId,
        selectedProvider: resolved.providerId,
        selectedVariant: resolved.variant,
        // The child never widens what the parent may do.
        permissionMode: parentSession?.permissionMode ?? null,
        autoApproveSeverity: await getWorkspaceAutoApproveSeverityFn(workspaceId || ''),
      });

      broadcastSessCreated(childSession);
    }

    // Notify caller of the child session ID immediately
    if (onSessionCreated) {
      await onSessionCreated(childSession.id);
    }

    // Add abort listener to update child session status if parent aborts
    if (abortSignal) {
      abortSignal.addEventListener('abort', abortHandler);
    }

    // Wrap inline schema as a transient ResponseFormat so the existing
    // structured output pipeline in agent.ts applies to the subagent.
    const responseFormat: ResponseFormat | undefined = outputSchema
      ? {
          id: `inline-task-${randomUUID()}`,
          name: 'Task Output',
          schema: outputSchema,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
      : undefined;

    const child = childSession;
    // Parent aborts reach the child only while the parent waits; once the
    // task turns async it runs to completion on its own.
    const childAbort = new AbortController();
    const forwardAbort = (): void => childAbort.abort(abortSignal?.reason);
    if (abortSignal?.aborted) forwardAbort();
    else abortSignal?.addEventListener('abort', forwardAbort, { once: true });
    const detachAbort = (): void => abortSignal?.removeEventListener('abort', forwardAbort);

    const finishRun = async (): Promise<SubagentOutput> => {
    const result = crossHarness
      ? await runChildOnHarness(deps, {
          harness,
          parentSessionId: sessionId,
          child,
          preconfig: subagentPreconfig,
          target: resolved,
          prompt,
          workspacePath,
          workspaceId,
          resumeFromHistory,
          outputSchema,
          abortSignal: childAbort.signal,
        })
      : await executeChild({
          parentSessionId: sessionId,
          childSessionId: child.id,
          preconfig: subagentPreconfig,
          prompt,
          workspacePath,
          workspaceId,
          resumeFromHistory,
          modelId: resolved.modelId,
          providerId: resolved.providerId,
          variant: resolved.variant ?? undefined,
          broadcast: broadcastFn,
          abortSignal: childAbort.signal,
          broadcastToSession: broadcastToSessionFn ?? ((event: Parameters<BroadcastFn>[0]) => {
            deps.broadcasts.toSession(sessionId, event);
          }),
          ...(responseFormat ? { responseFormat } : {}),
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

    // Extract ONLY the last text part - matching OpenCode behavior
    // Note: executeChildSession now returns parts instead of content
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

    // Format output like OpenCode with task_result tags
    const output = [
      `task_id: ${child.id} (for resuming to continue this task if needed)`,
      '',
      '<task_result>',
      text || 'No response generated',
      '</task_result>',
      structuredResult
        ? '\n<structured_result>\n' + JSON.stringify(structuredResult, null, 2) + '\n</structured_result>'
        : '',
    ].join('\n');

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
      run: finishRun().finally(detachAbort),
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
        result: `task_id: ${child.id} is running on ${harness}/${resolved.modelId ?? 'default'}. `
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
