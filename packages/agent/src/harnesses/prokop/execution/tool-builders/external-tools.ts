import { tool, jsonSchema } from 'ai';
import { getTool } from '@prokopai/core/infrastructure/tools/registry';
import { executeTool } from '@prokopai/core/infrastructure/tools/executor';
import { createLlmApi } from '@prokopai/core/infrastructure/tools/llm-api';
import { createWorkspaceCapability } from '@prokopai/core/infrastructure/filesystem/workspace-policy/policy';
import {
  createAskApi,
  rejectPendingAsksByToolCallId,
  type AskBroadcastFn,
} from '#agent/harnesses/prokop/permission/ask-user-api';
import { getToolWorkspaceHost } from '@prokopai/core/infrastructure/runtime/host-dependencies';
import { interruptManager } from '#agent/harnesses/prokop/execution/interrupt';
import { isToolAllowedInContext, type ToolExecutionScope } from '#agent/harnesses/prokop/execution/tool-capabilities';
import type { ToolMap } from '#agent/harnesses/prokop/execution/tool-builders/types';
import { resolveToolDefinition } from '@prokopai/core/infrastructure/runtime/host-dependencies';
import {
  capekToolOutputToAiSdk,
  createCapekToolOutputEnvelope,
} from '@prokopai/core/infrastructure/tools/model-output';

export interface ExternalToolsOptions {
  toolNames: string[];
  broadcastFn?: AskBroadcastFn;
  sessionId: string;
  workspaceId: string | undefined;
  workspacePath: string | undefined;
  rootSessionId: string;
  executionScopes: ReadonlySet<ToolExecutionScope>;
  modelId?: string;
  providerId?: string;
  additionalPaths?: string[];
  workspaceRootId?: string;
}

export async function buildExternalTools(options: ExternalToolsOptions): Promise<ToolMap> {
  const {
    toolNames,
    broadcastFn,
    sessionId,
    workspaceId,
    workspacePath,
    rootSessionId,
    executionScopes,
    modelId,
    providerId,
    additionalPaths,
    workspaceRootId,
  } = options;

  const tools: ToolMap = {};

  // Registry tools in toolNames order. Delegation is not built here: it is a
  // runtime tool on the workspace tool list, like the browser tools.
  for (const name of toolNames) {
    const loadedTool = await getTool(name);
    if (!loadedTool) continue;

    const definition = await resolveToolDefinition({
      sessionId,
      workspaceId,
      workspaceRootId,
      workspacePath,
      definition: loadedTool.definition,
    });
    if (!definition) continue;

    if (!isToolAllowedInContext(definition.capabilities, executionScopes)) {
      continue;
    }

    tools[name] = tool({
      description: definition.description,
      inputSchema: jsonSchema(definition.inputSchema),
      toModelOutput: ({ output }) => capekToolOutputToAiSdk(output),
      execute: async (args: Record<string, unknown>, { toolCallId }: { toolCallId: string }) => {
        const toolAbortController = interruptManager.registerToolExecution(sessionId, toolCallId);

        try {
          const llmFactory = () => createLlmApi(modelId, providerId, sessionId);
          const askFactory = (tcId: string) =>
            broadcastFn
              ? createAskApi(sessionId, tcId, definition.name, broadcastFn, workspaceId, rootSessionId)
              : (() => { throw new Error('Cannot ask user: no broadcast channel available (broadcastFn not provided)'); }) as import('@prokopai/sdk/tool').AskApi;

          const workspace = createWorkspaceCapability(getToolWorkspaceHost({
            workspaceId,
            workspacePath,
            additionalPaths,
            sessionId,
          }));
          const result = await executeTool({
            tool: loadedTool,
            args,
            workspace,
            sessionId,
            workspaceId,
            toolCallId,
            abortSignal: toolAbortController.signal,
            timeout: definition.timeout,
            createLlmApi: llmFactory,
            createAskApi: askFactory,
          });

          if (!result.success) {
            return { error: result.error ?? 'Tool execution failed' };
          }

          const clientResult = result.visualization && result.result && typeof result.result === 'object'
            ? { ...result.result as Record<string, unknown>, _visualization: result.visualization }
            : result.result;
          return createCapekToolOutputEnvelope(clientResult, result.modelOutput);
        } finally {
          interruptManager.unregisterToolExecution(sessionId, toolCallId);
          await rejectPendingAsksByToolCallId(toolCallId);
        }
      },
    });
  }

  return tools;
}
