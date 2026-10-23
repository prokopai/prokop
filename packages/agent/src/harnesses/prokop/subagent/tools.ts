/**
 * The delegation tools: one definition module and one entry point for every
 * harness. Served through the workspace MCP tool list (`composition/runtime-tools.ts`)
 * and executed over the Prokop subagent service with children on the host's
 * harness dispatch. A caller's harness changes nothing here.
 */

import type { SessionHarness } from '@prokopai/sdk';
import type { ToolDefinition } from '@prokopai/sdk/tool';
import { delegationHost } from '@prokopai/core/application/ports/delegation-host';
import { getHeadlessExecutionPort } from '@prokopai/core/application/ports/headless-execution';
import { harnessProbes } from '@prokopai/core/application/ports/harness-probes';
import { findModelVariantKeys, getModelsConfig } from '@prokopai/core/config';
import { getDelegationMaxChildren } from '@prokopai/core/infrastructure/runtime/environment';
import { resolveModelId, resolveProviderId } from '@prokopai/core/infrastructure/providers/model-selection';
import {
  emitRuntimeEvent,
  emitSessionCreated,
  emitSessionUpdated,
  emitToSession,
} from '@prokopai/core/infrastructure/runtime/host-dependencies';
import {
  createSession,
  getChildSessions,
  getSession,
  getWorkspaceAutoApproveSeverity,
  listMessagesWithParts,
  updateSession,
} from '@prokopai/core/infrastructure/storage/runtime';
import { getPreconfigOrAgent, listSubagentPreconfigs } from '#agent/harnesses/prokop/context/sources';
import { buildDelegationCapabilities } from '#agent/harnesses/prokop/subagent/delegation';
import { resolveEffectiveSubagentTargets } from '#agent/harnesses/prokop/subagent/policy';
import { DELEGATION_TOOL_NAMES, isDelegationToolName, type DelegationToolName } from '#agent/harnesses/shared/tool-viz';
import {
  buildTaskToolDefinition,
  executeSubagentWithDeps,
  executeTaskCancel,
  executeTaskStatus,
  readDelegationTarget,
  rememberDelegationTarget,
  type DelegationAsk,
  type SubagentServiceDeps,
} from '#agent/harnesses/prokop/subagent/task-tool';

type Definition = { type: 'function'; name: string; description: string; inputSchema: unknown };

export interface DelegationToolContext {
  sessionId: string;
  workspaceId: string;
  workspacePath: string;
  /** The calling turn's signal: an abort while the parent waits cancels the child. */
  signal?: AbortSignal;
  /** Asks the user; absent means an ask the policy requires is refused. */
  ask?: DelegationAsk;
}

const DELEGATE_DESCRIPTION = `Hand a task to a child session running one of the user's roles, on that role's harness and model or on ones you pick, and get its result back.

Use your own native subagents, where you have them, for same-harness, same-model work. Use delegate_task when the user defined a role (subagent_type) for the task, when it should run on another harness (prokop, codex-cli, claude-cli) or model, or when the user asks. Call delegation_capabilities first to see the roles with their defaults, the harnesses and models, and whether you may override.

subagent_type is always required. The role runs on its own harness and model, or on yours when it sets none. target overrides that for one task, including the reasoning effort (target.variant, from the efforts delegation_capabilities lists); the agent's delegation targets setting says whether that is allowed outright, asks the user, or is refused.

mode "async" (default) returns at once with status "running"; the result arrives later as a new message "[task <id> ... finished]" and you continue other work meanwhile. mode "wait" blocks until the child finishes or timeoutMs passes (default 10 minutes), after which the task continues async. Never poll for a result; it comes to you. task_status is for an explicit check, task_cancel stops a task.

The child starts with your prompt only, never your history: describe the task fully and say exactly what to return. Use outputSchema for machine-readable results. Pass task_id to continue an earlier child with its context.`;

/** The efforts a CLI harness's models support, as the host's catalog reports them. */
export interface HarnessEfforts {
  harness: SessionHarness;
  efforts: string[];
}

/** The target's variant, spelled out with the efforts each harness offers so the model picks from real options. */
function variantDescription(efforts: readonly HarnessEfforts[]): string {
  const ladders = efforts.filter((entry) => entry.efforts.length > 0)
    .map((entry) => `${entry.harness}: ${entry.efforts.join(', ')}`).join('; ');
  return (ladders
    ? `Reasoning effort for a CLI model. ${ladders}. Each model supports a subset and has a default; delegation_capabilities lists both per model. `
    : 'Reasoning effort for a CLI model, one of the efforts delegation_capabilities lists per model. ')
    + 'On prokop: one of the model\'s variants as delegation_capabilities lists them. Omitted: the role\'s effort, the parent\'s when the child runs on the parent\'s model, else the model\'s default.';
}

function delegateDefinition(efforts: readonly HarnessEfforts[]): ToolDefinition {
  const base = buildTaskToolDefinition([]);
  const properties = { ...(base.inputSchema as { properties: Record<string, unknown> }).properties };
  properties.subagent_type = { type: 'string', description: 'A role (subagent type) from delegation_capabilities. Required.' };
  const target = properties.target as { properties: Record<string, unknown> };
  properties.target = {
    ...target,
    properties: {
      ...target.properties,
      model: { type: 'string', description: 'A model id of the target harness; delegation_capabilities lists them.' },
      variant: { type: 'string', description: variantDescription(efforts) },
    },
  };
  properties.mode = {
    type: 'string',
    enum: ['wait', 'async'],
    description: 'async (default): return now; the result arrives as a message. wait: block for the result, up to timeoutMs.',
  };
  properties.isolation = {
    type: 'string',
    enum: ['worktree', 'checkout'],
    description: 'Start a top-level session instead of a subagent; the user may be asked first. worktree: on its own branch and managed worktree, for implementation work that becomes a branch. checkout: in the current checkout, sharing your working tree, for work the user should follow as its own session.',
  };
  properties.baseBranch = { type: 'string', description: 'With isolation worktree: the local branch to branch from (default: the current branch).' };
  return {
    ...base,
    name: 'delegate_task',
    description: DELEGATE_DESCRIPTION,
    inputSchema: { ...(base.inputSchema as Record<string, unknown>), properties, required: ['description', 'prompt', 'subagent_type'] },
  };
}

const CAPABILITIES_DEFINITION: Definition = {
  type: 'function',
  name: 'delegation_capabilities',
  description: 'What you can delegate to: your roles (subagent types) with their default harness and model, the harnesses '
    + 'enabled on this machine with a short list of their models, whether you may override a role\'s harness and model, '
    + 'and the limits. Call it before delegate_task with a target. Pass search to find models beyond the short lists.',
  inputSchema: {
    type: 'object',
    properties: { search: { type: 'string', description: 'Filter models by id or name (case-insensitive).' } },
  },
};

const STATUS_DEFINITION: Definition = {
  type: 'function',
  name: 'task_status',
  description: 'Where a delegated task stands (running, completed, failed, cancelled, interrupted), whether it waits on a question, '
    + 'and its last answer once it settled. Results also arrive on their own; use this for an explicit check, not in a loop.',
  inputSchema: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] },
};

const CANCEL_DEFINITION: Definition = {
  type: 'function',
  name: 'task_cancel',
  description: 'Stop a running delegated task. Its own children stop with it.',
  inputSchema: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] },
};

export { DELEGATION_TOOL_NAMES, type DelegationToolName };
export const isDelegationTool = isDelegationToolName;

export function delegationToolDefinitions(efforts: readonly HarnessEfforts[] = []): Definition[] {
  const delegate = delegateDefinition(efforts);
  return [
    { type: 'function', name: delegate.name, description: delegate.description, inputSchema: delegate.inputSchema },
    CAPABILITIES_DEFINITION,
    STATUS_DEFINITION,
    CANCEL_DEFINITION,
  ];
}

function serviceDeps(): SubagentServiceDeps {
  return {
    sessionAccess: { getSession, createSession, updateSession, getWorkspaceAutoApproveSeverity, listChildSessions: getChildSessions },
    // "Allow for this agent" writes the harness into the agent's delegation targets.
    preconfigs: { getPreconfigOrAgent, listSubagentPreconfigs, allowDelegationTarget: rememberDelegationTarget },
    broadcasts: {
      event: emitRuntimeEvent,
      sessionCreated: emitSessionCreated,
      sessionUpdated: emitSessionUpdated,
      toSession: (sessionId, event) => emitToSession(sessionId, event),
    },
    runOnHarness: (input, options) => {
      const port = getHeadlessExecutionPort();
      return port ? port.run(input, options) : Promise.resolve({ error: 'Harness dispatch is unavailable' });
    },
    readTranscript: (sessionId) => listMessagesWithParts(sessionId),
    host: delegationHost(),
    catalog: {
      prokopModels: () => getModelsConfig().providers.flatMap((provider) =>
        provider.models.map((model) => ({ id: model.id, name: model.name, providerId: provider.id,
          variants: findModelVariantKeys(model.id, provider.id) }))),
      harnessModels: (harness) => harnessProbes().models(harness),
    },
    maxChildren: getDelegationMaxChildren,
  };
}

export async function executeDelegationTool(
  tool: DelegationToolName,
  input: Record<string, unknown>,
  context: DelegationToolContext,
): Promise<Record<string, unknown>> {
  const deps = serviceDeps();
  switch (tool) {
    case 'delegate_task': {
      const output = await executeSubagentWithDeps({
        description: String(input.description ?? ''),
        prompt: String(input.prompt ?? ''),
        subagent_type: typeof input.subagent_type === 'string' && input.subagent_type ? input.subagent_type : undefined,
        target: readDelegationTarget(input.target),
        // Async on every harness; the model asks for a blocking wait explicitly.
        mode: input.mode === 'wait' ? 'wait' : 'async',
        timeoutMs: typeof input.timeoutMs === 'number' ? input.timeoutMs : undefined,
        clientRequestId: typeof input.clientRequestId === 'string' && input.clientRequestId ? input.clientRequestId : undefined,
        isolation: input.isolation === 'worktree' || input.isolation === 'checkout' ? input.isolation : undefined,
        baseBranch: typeof input.baseBranch === 'string' && input.baseBranch ? input.baseBranch : undefined,
        ...(context.ask ? { ask: context.ask } : {}),
        task_id: typeof input.task_id === 'string' ? input.task_id : undefined,
        sessionId: context.sessionId,
        workspaceId: context.workspaceId,
        workspacePath: context.workspacePath,
        abortSignal: context.signal,
        ...(input.outputSchema && typeof input.outputSchema === 'object' ? { outputSchema: input.outputSchema as Record<string, unknown> } : {}),
      }, deps);
      return output as unknown as Record<string, unknown>;
    }
    case 'delegation_capabilities': {
      const session = await getSession(context.sessionId);
      const parentPreconfig = session?.preconfigId ? await getPreconfigOrAgent(session.preconfigId) : null;
      const roles = await resolveEffectiveSubagentTargets({
        sessionId: context.sessionId,
        canSpawnSubagents: parentPreconfig?.canSpawnSubagents ?? true,
        allowSelfAsSubagent: parentPreconfig?.allowSelfAsSubagent,
      }, { getSession, listPreconfigs: listSubagentPreconfigs });
      const capabilities = await buildDelegationCapabilities({
        roles,
        caller: {
          harness: session?.harness ?? 'prokop',
          model: session ? resolveModelId(session, parentPreconfig) : null,
          provider: session ? resolveProviderId(session, parentPreconfig) : null,
        },
        parentPreconfig,
        host: deps.host!,
        catalog: deps.catalog!,
        limits: { depth: 2, maxChildren: getDelegationMaxChildren(), maxLaunches: delegationHost().maxLaunches() },
        search: typeof input.search === 'string' ? input.search : undefined,
      });
      return capabilities as unknown as Record<string, unknown>;
    }
    case 'task_status':
      return await executeTaskStatus({ task_id: String(input.task_id ?? ''), sessionId: context.sessionId }, deps) as unknown as Record<string, unknown>;
    case 'task_cancel':
      return await executeTaskCancel({ task_id: String(input.task_id ?? ''), sessionId: context.sessionId }, deps) as unknown as Record<string, unknown>;
  }
}
