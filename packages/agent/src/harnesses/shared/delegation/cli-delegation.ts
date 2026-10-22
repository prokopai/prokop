/**
 * The delegation tools as a CLI parent sees them: one definition module for
 * Claude CLI (in-process MCP) and Codex CLI (dynamic tools), executed over
 * the Prokop subagent service with children on the host's harness dispatch.
 * Prokop sessions get the same service through the `task` tool.
 */

import type { ToolDefinition } from '@prokopai/sdk/tool';
import { delegationHost } from '@prokopai/core/application/ports/delegation-host';
import { getHeadlessExecutionPort } from '@prokopai/core/application/ports/headless-execution';
import { harnessProbes } from '@prokopai/core/application/ports/harness-probes';
import { getModelsConfig } from '@prokopai/core/config';
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
import { executeChildSession } from '#agent/harnesses/prokop/subagent/child-session';
import { buildDelegationCapabilities } from '#agent/harnesses/prokop/subagent/delegation';
import { resolveEffectiveSubagentTargets } from '#agent/harnesses/prokop/subagent/policy';
import {
  buildTaskToolDefinition,
  executeSubagentWithDeps,
  executeTaskCancel,
  executeTaskStatus,
  readDelegationTarget,
  type SubagentServiceDeps,
} from '#agent/harnesses/prokop/subagent/task-tool';

type Definition = { type: 'function'; name: string; description: string; inputSchema: unknown };

interface Context {
  sessionId: string;
  workspaceId: string;
  workspacePath: string;
}

const DELEGATE_DESCRIPTION = `Hand a task to a child session on any enabled harness and model, and get its result back.

Use your own native subagents for same-harness, same-model work. Use delegate_task when the task should run on another harness (prokop, codex-cli, claude-cli) or model, when the user defined a role (subagent_type) for it, or when the user asks. Call delegation_capabilities first to see roles, harnesses, models and what you may target.

A role pinned to a harness or model always runs there; a target cannot change it. A role without a pin, or no role at all (then the child uses your own role), may take a target.

mode "async" (default here) returns at once with status "running"; the result arrives later as a new message "[task <id> ... finished]" and you continue other work meanwhile. mode "wait" blocks until the child finishes or timeoutMs passes (default 10 minutes), after which the task continues async. Never poll for a result; it comes to you. task_status is for an explicit check, task_cancel stops a task.

The child starts with your prompt only, never your history: describe the task fully and say exactly what to return. Use outputSchema for machine-readable results. Pass task_id to continue an earlier child with its context.`;

function delegateDefinition(): ToolDefinition {
  const base = buildTaskToolDefinition([]);
  const properties = { ...(base.inputSchema as { properties: Record<string, unknown> }).properties };
  // CLI parents default to async: an MCP or dynamic tool call should not sit
  // on a long child turn unless the model asks for it.
  properties.subagent_type = { type: 'string', description: 'A role (subagent type) from delegation_capabilities. Omit to use your own role on a target.' };
  properties.mode = {
    type: 'string',
    enum: ['wait', 'async'],
    description: 'async (default): return now; the result arrives as a message. wait: block for the result, up to timeoutMs.',
  };
  return {
    ...base,
    name: 'delegate_task',
    description: DELEGATE_DESCRIPTION,
    inputSchema: { ...(base.inputSchema as Record<string, unknown>), properties, required: ['description', 'prompt'] },
  };
}

const CAPABILITIES_DEFINITION: Definition = {
  type: 'function',
  name: 'delegation_capabilities',
  description: 'What you can delegate to: your roles (subagent types) with their pinned harness and model, the harnesses '
    + 'enabled on this machine with a short list of their models, which targets you may name without a role, and the '
    + 'limits. Call it before delegate_task with a target. Pass search to find models beyond the short lists.',
  inputSchema: {
    type: 'object',
    properties: { search: { type: 'string', description: 'Filter models by id or name (case-insensitive).' } },
  },
};

export const STATUS_DEFINITION: Definition = {
  type: 'function',
  name: 'task_status',
  description: 'Where a delegated task stands (running, completed, failed, cancelled, interrupted), whether it waits on a question, '
    + 'and its last answer once it settled. Results also arrive on their own; use this for an explicit check, not in a loop.',
  inputSchema: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] },
};

export const CANCEL_DEFINITION: Definition = {
  type: 'function',
  name: 'task_cancel',
  description: 'Stop a running delegated task. Its own children stop with it.',
  inputSchema: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] },
};

export function cliDelegationDefinitions(): Definition[] {
  const delegate = delegateDefinition();
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
    preconfigs: { getPreconfigOrAgent, listSubagentPreconfigs },
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
    host: delegationHost(),
    catalog: {
      prokopModels: () => getModelsConfig().providers.flatMap((provider) =>
        provider.models.map((model) => ({ id: model.id, name: model.name, providerId: provider.id }))),
      harnessModels: (harness) => harnessProbes().models(harness),
    },
    maxChildren: getDelegationMaxChildren,
    childrenOnHost: true,
  };
}

export async function executeCliDelegation(
  tool: 'delegate_task' | 'delegation_capabilities' | 'task_status' | 'task_cancel',
  input: Record<string, unknown>,
  context: Context,
): Promise<Record<string, unknown>> {
  const deps = serviceDeps();
  switch (tool) {
    case 'delegate_task': {
      const output = await executeSubagentWithDeps({
        description: String(input.description ?? ''),
        prompt: String(input.prompt ?? ''),
        subagent_type: typeof input.subagent_type === 'string' && input.subagent_type ? input.subagent_type : undefined,
        target: readDelegationTarget(input.target),
        mode: input.mode === 'wait' ? 'wait' : 'async',
        timeoutMs: typeof input.timeoutMs === 'number' ? input.timeoutMs : undefined,
        clientRequestId: typeof input.clientRequestId === 'string' && input.clientRequestId ? input.clientRequestId : undefined,
        task_id: typeof input.task_id === 'string' ? input.task_id : undefined,
        sessionId: context.sessionId,
        workspaceId: context.workspaceId,
        workspacePath: context.workspacePath,
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
        limits: { depth: 2, maxChildren: getDelegationMaxChildren() },
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
