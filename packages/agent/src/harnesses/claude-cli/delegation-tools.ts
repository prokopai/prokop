import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { getSession } from '@prokopai/core/infrastructure/storage/runtime';
import type { DelegationDomainBridge } from '#agent/harnesses/shared/domain-tools';

const MAX_ARGUMENTS = 64_000;
const MAX_RESULT = 64_000;

const targetShape = z.object({
  harness: z.enum(['prokop', 'codex-cli', 'claude-cli']).optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
  variant: z.string().optional(),
}).optional().describe('Where the child runs when the role does not pin it: harness and, optionally, model, provider (Prokop only) and variant or effort.');

/** Mirrors the delegate_task input schema; a test pins it to the live definition. */
export const claudeDelegateShape = {
  description: z.string().describe('A short (3-5 words) description of the task'),
  prompt: z.string().describe('The task for the child, with exactly what to return in its final message'),
  subagent_type: z.string().optional().describe('A role (subagent type) from delegation_capabilities. Omit to use your own role on a target.'),
  target: targetShape,
  mode: z.enum(['wait', 'async']).optional().describe('async (default): return now; the result arrives as a message. wait: block for the result, up to timeoutMs.'),
  timeoutMs: z.number().optional().describe('wait only: how long to wait before the task turns async (default 600000).'),
  clientRequestId: z.string().optional().describe('Stable id for this logical task; a retried call returns the same task.'),
  task_id: z.string().optional().describe('Continue an earlier child with its context.'),
  outputSchema: z.record(z.string(), z.unknown()).optional().describe('JSON Schema the child must answer with.'),
};

export const claudeCapabilitiesShape = {
  search: z.string().optional().describe('Filter models by id or name (case-insensitive).'),
};

export const claudeTaskIdShape = {
  task_id: z.string(),
};

const fail = (message: string): { content: Array<{ type: 'text'; text: string }>; isError: boolean } => ({
  content: [{ type: 'text', text: message }], isError: true,
});

/** Register the delegation tools for one Claude turn on the in-process MCP server. */
export function createClaudeDelegationTools(options: {
  bridge: DelegationDomainBridge;
  definitions?: ReturnType<DelegationDomainBridge['definitions']>;
  sessionId: string;
  workspaceId: string;
  root: string;
  preconfigId: string | null;
  signal: AbortSignal;
}): SdkMcpToolDefinition[] {
  const definitions = (options.definitions ?? options.bridge.definitions()).filter(definition => definition.type === 'function');
  const byName = new Map(definitions.map(definition => [definition.name, definition]));
  // The turn, its preconfig, and its workspace must still own the call when it runs.
  const authorized = async (): Promise<boolean> => {
    if (options.signal.aborted) return false;
    try {
      const current = await getSession(options.sessionId);
      return !!current && current.harness === 'claude-cli' && current.status === 'active'
        && current.workspaceId === options.workspaceId && current.preconfigId === options.preconfigId;
    } catch { return false; }
  };
  const context = { sessionId: options.sessionId, workspaceId: options.workspaceId, workspacePath: options.root };
  const run = (name: string, execute: (input: Record<string, unknown>) => Promise<Record<string, unknown>>) =>
    async (input: Record<string, unknown>) => {
      if (!await authorized()) return fail(`${name} unavailable`);
      if (JSON.stringify(input).length > MAX_ARGUMENTS) return fail(`Invalid ${name} arguments`);
      try {
        const result = await execute(input);
        const text = JSON.stringify(result);
        return { content: [{ type: 'text' as const, text: text.length <= MAX_RESULT ? text : `${text.slice(0, MAX_RESULT)}\n[truncated]` }],
          isError: typeof result.error === 'string' && !result.result };
      } catch (error: unknown) {
        return fail(error instanceof Error ? error.message : `${name} failed`);
      }
    };
  const tools: SdkMcpToolDefinition[] = [];
  const delegate = byName.get('delegate_task');
  if (delegate) {
    tools.push(tool('delegate_task', delegate.description, claudeDelegateShape,
      run('delegate_task', input => options.bridge.delegate(input, context)), { alwaysLoad: true }) as unknown as SdkMcpToolDefinition);
  }
  const capabilities = byName.get('delegation_capabilities');
  if (capabilities) {
    tools.push(tool('delegation_capabilities', capabilities.description, claudeCapabilitiesShape,
      run('delegation_capabilities', input => options.bridge.capabilities(input, context)), { alwaysLoad: true }) as unknown as SdkMcpToolDefinition);
  }
  const status = byName.get('task_status');
  if (status) {
    tools.push(tool('task_status', status.description, claudeTaskIdShape,
      run('task_status', input => options.bridge.status(input, context)), { alwaysLoad: true }) as unknown as SdkMcpToolDefinition);
  }
  const cancel = byName.get('task_cancel');
  if (cancel) {
    tools.push(tool('task_cancel', cancel.description, claudeTaskIdShape,
      run('task_cancel', input => options.bridge.cancel(input, context)), { alwaysLoad: true }) as unknown as SdkMcpToolDefinition);
  }
  return tools;
}
