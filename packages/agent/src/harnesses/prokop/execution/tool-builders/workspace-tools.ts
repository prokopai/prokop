import { tool, jsonSchema } from 'ai';
import {
  getContributedDomainToolPayloads,
  getDomainToolFallback,
  mergeDomainToolVisualization,
  type DomainToolPayload,
} from '@prokopai/core/infrastructure/tools/domain-tool-source';
import { getWorkspace } from '@prokopai/core/infrastructure/storage/runtime';
import {
  createAskApi,
  rejectPendingAsksByToolCallId,
  type AskBroadcastFn,
} from '#agent/harnesses/prokop/permission/ask-user-api';
import { interruptManager } from '#agent/harnesses/prokop/execution/interrupt';
import type { ToolMap } from '#agent/harnesses/prokop/execution/tool-builders/types';

export interface WorkspaceToolsOptions {
  workspaceId: string;
  workspacePath: string;
  rootSessionId: string;
  sessionId: string;
  broadcastFn?: AskBroadcastFn;
  agentId?: string | null;
  allowedSkills?: string[] | null;
  agentSkillsDir?: string;
}

export async function buildWorkspaceTools(options: WorkspaceToolsOptions): Promise<ToolMap> {
  const {
    workspaceId,
    workspacePath,
    rootSessionId,
    sessionId,
    broadcastFn,
    agentId,
    allowedSkills,
    agentSkillsDir,
  } = options;

  const tools: ToolMap = {};
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) return tools;

  // The generic contributed-domain-tool payload map is resolved once and
  // shared by the skill, memory, skill_manage and session_search builders:
  // null means the unscoped path (registered fallbacks may apply), an empty
  // map means a composed scope without domain payloads (fallbacks disabled).
  const scopedDomainPayloads = getContributedDomainToolPayloads();
  const domainPayload = (name: string): DomainToolPayload | null =>
    scopedDomainPayloads === null
      ? getDomainToolFallback(name)
      : scopedDomainPayloads.get(name) ?? null;

  // ── Skill tool ────────────────────────────────────────────
  if (workspacePath) {
    const skillPayload = domainPayload('skill');
    const skillDefinition = await skillPayload?.resolveDefinition?.(sessionId, {
      workspacePath,
      allowedSkills,
      agentSkillsDir,
    });
    if (skillPayload && skillDefinition) {
      tools['skill'] = tool({
        description: skillDefinition.description,
        inputSchema: jsonSchema(skillDefinition.inputSchema),
        execute: async (args: Record<string, unknown>) =>
          skillPayload.execute(args, {
            workspaceId,
            sessionId,
            ask: async () => {
              throw new Error('Cannot ask user: no broadcast channel available');
            },
            agentId,
            workspacePath,
            allowedSkills,
            agentSkillsDir,
          }).then((result) => mergeDomainToolVisualization(skillPayload, args, result)),
      });
    }
  }

  // ── Memory tool ───────────────────────────────────────────
  const memoryPayload = domainPayload('memory');
  const memorySettings = workspace.settings?.memory;
  if (memoryPayload && memorySettings?.enabled) {
    const permissionRisk = memorySettings.permissionRisk;
    tools['memory'] = tool({
      description: memoryPayload.description,
      inputSchema: jsonSchema(memoryPayload.inputSchema),
      execute: async (args: Record<string, unknown>, { toolCallId }: { toolCallId: string }) => {
        const _toolAbortController = interruptManager.registerToolExecution(sessionId, toolCallId);
        try {
          const askApi = createAskApiOrThrow(sessionId, toolCallId, 'memory', broadcastFn, workspaceId, rootSessionId);
          const result = await memoryPayload.execute(args, {
            workspaceId,
            sessionId,
            ask: (ask: import('@prokopai/sdk/tool').Ask) => askApi(ask),
            agentId,
            workspacePath,
            permissionRisk,
          });
          return mergeDomainToolVisualization(memoryPayload, args, result);
        } finally {
          interruptManager.unregisterToolExecution(sessionId, toolCallId);
          await rejectPendingAsksByToolCallId(toolCallId);
        }
      },
    });
  }

  // ── Skill management tool ─────────────────────────────────
  const skillManagePayload = domainPayload('skill_manage');
  const skillSettings = workspace.settings?.skills;
  if (skillManagePayload && skillSettings?.managementEnabled) {
    const permissionRisk = skillSettings.permissionRisk;
    const skillManageDefinition = await skillManagePayload.resolveDefinition?.(sessionId, {
      workspacePath,
    });
    if (skillManageDefinition) {
      tools['skill_manage'] = tool({
        description: skillManageDefinition.description,
        inputSchema: jsonSchema(skillManageDefinition.inputSchema),
        execute: async (args: Record<string, unknown>, { toolCallId }: { toolCallId: string }) => {
          const _toolAbortController = interruptManager.registerToolExecution(sessionId, toolCallId);
          try {
          const askApi = createAskApiOrThrow(sessionId, toolCallId, 'skill_manage', broadcastFn, workspaceId, rootSessionId);
          const result = await skillManagePayload.execute(args, {
            workspaceId,
            sessionId,
            ask: (ask: import('@prokopai/sdk/tool').Ask) => askApi(ask),
            agentId,
            workspacePath,
            permissionRisk,
          });
          return mergeDomainToolVisualization(skillManagePayload, args, result);
          } finally {
            interruptManager.unregisterToolExecution(sessionId, toolCallId);
            await rejectPendingAsksByToolCallId(toolCallId);
          }
        },
      });
    }
  }

  // ── Session search tool ───────────────────────────────────
  // The domain payload owns the settings gate (isEnabled) and the executor;
  // the settings values the executor needs are captured here at build time
  // exactly like pre-C5 and passed through the execution context.
  const sessionSearchPayload = domainPayload('session_search');
  const searchSettings = workspace.settings?.sessionSearch;
  if (sessionSearchPayload && await sessionSearchPayload.isEnabled?.(workspaceId, sessionId) === true) {
    tools['session_search'] = tool({
      description: sessionSearchPayload.description,
      inputSchema: jsonSchema(sessionSearchPayload.inputSchema as Record<string, unknown>),
      execute: async (args: Record<string, unknown>, { toolCallId }: { toolCallId: string }) => {
        const _toolAbortController = interruptManager.registerToolExecution(sessionId, toolCallId);
        try {
          const askApi = createAskApiOrThrow(sessionId, toolCallId, sessionSearchPayload.name, broadcastFn, workspaceId, rootSessionId);
          const result = await sessionSearchPayload.execute(
            args,
            {
              workspaceId,
              sessionId,
              ask: (ask: import('@prokopai/sdk/tool').Ask) => askApi(ask),
              agentId,
              permissionRisk: searchSettings?.permissionRisk,
              includeToolResults: searchSettings?.includeToolResults === true,
            },
          );
          return mergeDomainToolVisualization(sessionSearchPayload, args, result);
        } finally {
          interruptManager.unregisterToolExecution(sessionId, toolCallId);
          await rejectPendingAsksByToolCallId(toolCallId);
        }
      },
    });
  }

  return tools;
}

// ── Shared helpers ───────────────────────────────────────────

function createAskApiOrThrow(
  sessionId: string,
  toolCallId: string,
  toolName: string,
  broadcastFn: AskBroadcastFn | undefined,
  workspaceId: string | undefined,
  rootSessionId: string,
): import('@prokopai/sdk/tool').AskApi {
  if (!broadcastFn) {
    throw new Error('Cannot ask user: no broadcast channel available');
  }
  return createAskApi(sessionId, toolCallId, toolName, broadcastFn, workspaceId, rootSessionId);
}
