import { getAgentDirectory } from '#agent/harnesses/prokop/context/sources';
import { discoverWorkspaceTools } from '@prokopai/core/infrastructure/tools/tool-source';
import {
  buildRetrieveToolOutputAiTool,
  RETRIEVE_TOOL_OUTPUT_NAME,
  wrapToolsWithOutputPolicy,
} from '#agent/harnesses/prokop/tool-output/policy';
import { getSession } from '@prokopai/core/infrastructure/storage/runtime';
import type { AskBroadcastFn } from '#agent/harnesses/prokop/permission/ask-user-api';
import { hasScopedToolRegistryResolver } from '@prokopai/core/infrastructure/tools/registry';
import { join } from 'path';
import { buildExternalTools } from '#agent/harnesses/prokop/execution/tool-builders/external-tools';
import { buildWorkspaceTools } from '#agent/harnesses/prokop/execution/tool-builders/workspace-tools';
import { buildAgentTools } from '#agent/harnesses/prokop/execution/tool-builders/agent-tools';
import { resolveToolExecutionScopes } from '#agent/harnesses/prokop/execution/tool-capabilities';
import type { PreconfigCapabilities } from '@prokopai/sdk/types';
import type { ToolMap } from '#agent/harnesses/prokop/execution/tool-builders/types';
import { buildToolSearchTool, deferrableMcpTools, MCP_TOOL_SEARCH_THRESHOLD, setDeferredTools, TOOL_SEARCH_NAME } from '#agent/harnesses/prokop/execution/tool-search';

export interface BuildToolsOptions {
  toolNames: string[];
  workspacePath: string | undefined;
  workspaceId: string | undefined;
  sessionId: string;
  rootSessionId?: string;
  modelId?: string;
  providerId?: string;
  allowedSkills?: string[] | null;
  capabilities?: PreconfigCapabilities | null;
  broadcastFn?: AskBroadcastFn;
  additionalPaths?: string[];
  agentId?: string | null;
  workspaceRootId?: string;
}

export async function buildAiSdkTools(
  options: BuildToolsOptions,
): Promise<Record<string, import('ai').Tool>> {
  const {
    toolNames,
    workspacePath,
    workspaceId,
    sessionId,
    rootSessionId: explicitRootSessionId,
    modelId,
    providerId,
    allowedSkills,
    capabilities,
    broadcastFn,
    additionalPaths,
    agentId,
    workspaceRootId,
  } = options;

  // Resolve root session ID by walking up the parent chain
  const rootSessionId = explicitRootSessionId ?? (await (async () => {
    let current = sessionId;
    let session = await getSession(current);
    while (session?.parentId) {
      current = session.parentId;
      session = await getSession(current);
    }
    return current;
  })());

  // Resolve execution scopes for capability filtering (separate from ask-routing root)
  const executionScopes = await resolveToolExecutionScopes(sessionId);

  // Resolve agent directory for skills
  const agentDir = agentId ? await getAgentDirectory(agentId) : undefined;
  const agentSkillsDir = agentDir ? join(agentDir, 'skills') : undefined;

  // Phase 1: registry tools
  const externalTools = await buildExternalTools({
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
  });
  const tools: ToolMap = { ...externalTools };

  // Phase 2: Workspace-gated tools (memory, skills, session search)
  if (workspaceId && workspacePath) {
    const workspaceTools = await buildWorkspaceTools({
      workspaceId,
      workspacePath,
      rootSessionId,
      sessionId,
      broadcastFn,
      agentId,
      allowedSkills,
      agentSkillsDir,
    });
    Object.assign(tools, workspaceTools);

    // Phase 3: MCP tools. Above the threshold the external ones are deferred
    // behind tool_search (docs/plans/mcp-tool-lookup.md); they stay in the set
    // and prepareStep keeps them from the provider until loaded.
    try {
      const mcpTools = await discoverWorkspaceTools(workspacePath, sessionId);
      Object.assign(tools, mcpTools);
      const deferrable = deferrableMcpTools(mcpTools);
      if (deferrable.length > MCP_TOOL_SEARCH_THRESHOLD) {
        setDeferredTools(sessionId, deferrable.map((entry) => entry.name));
        tools[TOOL_SEARCH_NAME] = buildToolSearchTool(sessionId, deferrable);
      } else {
        setDeferredTools(sessionId, []);
      }
    } catch (err) {
      console.error('Failed to load MCP tools:', err);
    }
  } else {
    setDeferredTools(sessionId, []);
  }

  // Phase 4: Agent-specific tools (agent_memory, agent_skill_manage)
  if (agentDir) {
    const agentTools = await buildAgentTools({ agentDir, capabilities });
    Object.assign(tools, agentTools);
  }

  // The unscoped legacy Jean2 path keeps the unconditional retrieval
  // injection. Under a scoped contributed resolver, retrieval is an
  // ordinary contributed tool: it enters through toolNames -> resolver ->
  // buildExternalTools exactly when its contribution is visible.
  if (!hasScopedToolRegistryResolver()) {
    tools[RETRIEVE_TOOL_OUTPUT_NAME] = buildRetrieveToolOutputAiTool(sessionId);
  }
  return wrapToolsWithOutputPolicy(tools, { sessionId, workspaceId });
}
