import type { AgentSide, Audience, HostHandlers, NotificationHandlers } from '@prokopai/agent-protocol';
import type { AskAuthority, AssistantMessage, ServerMessage } from '@prokopai/sdk/types';
import type { InteractionHost, PendingAskRecord, WorkspaceCapabilityBindings } from '@/infrastructure/runtime/host';

/** Where delivered wire messages go on the host (WebSocket broadcast in production). */
export interface HostDeliveryRouter {
  broadcast(message: ServerMessage): void;
  broadcastToSession(sessionId: string, message: ServerMessage): void;
  sendToController(sessionId: string, message: ServerMessage): void;
  sendToAskTargets(sessionId: string, authority: AskAuthority, message: ServerMessage): void;
}

export interface RuntimeHostServices {
  interaction: InteractionHost;
  resolveSessionWorkspace: NonNullable<WorkspaceCapabilityBindings['resolveSessionWorkspace']>;
  /** Workspace whose memory and skills a path shares (managed worktrees map to their workspace). */
  knowledgeRoot?(workspacePath: string): string;
  addWorkspaceRoot(workspaceId: string, path: string): boolean | Promise<boolean>;
  removeWorkspaceRoot(workspaceId: string, path: string): boolean | Promise<boolean>;
  router: HostDeliveryRouter;
  /** Push for a finished top-level reply (Prokop's `terminal` runtime event). */
  notifyTurnFinished(message: AssistantMessage, sessionId: string): void;
  notifyFilesChanged?(sessionId: string): void;
  notifyWorktreeChanged?(worktreeId: string): void;
}

/**
 * Host side of the runtime-host protocol: pending asks and grants, session
 * root resolution, extra workspace roots, and routing of delivered wire
 * messages. The host interprets no `ServerMessage`; it routes by audience.
 */
export function createRuntimeHostHandlers(services: RuntimeHostServices): {
  handlers: HostHandlers;
  notifications: NotificationHandlers<AgentSide>;
} {
  const { interaction } = services;
  const route = (audience: Audience, message: ServerMessage): void => {
    switch (audience.scope) {
      case 'global': services.router.broadcast(message); break;
      case 'session': services.router.broadcastToSession(audience.sessionId, message); break;
      case 'controller': services.router.sendToController(audience.sessionId, message); break;
      case 'ask_targets': services.router.sendToAskTargets(audience.sessionId, audience.authority, message); break;
      // Origin-scoped messages need the turn's connection; they arrive with turn.start in step 1i.
      case 'origin': break;
    }
  };

  return {
    handlers: {
      'interaction.createPendingAsk': async ({ record }) => ({
        id: await interaction.createPendingAsk(record as Omit<PendingAskRecord, 'id'>),
      }),
      'interaction.removePendingAsk': async ({ id }) => {
        await interaction.removePendingAsk(id);
        return {};
      },
      'interaction.removeByToolCallId': async ({ toolCallId }) => {
        await interaction.removePendingAsksByToolCallId(toolCallId);
        return {};
      },
      'interaction.getRequest': ({ requestId }) => interaction.getPermissionRequestByRequestId(requestId),
      'interaction.resolveRequest': async ({ requestId, status, resolution }) => ({
        resolved: await interaction.resolvePermissionRequestByRequestId(requestId, status, resolution),
      }),
      'interaction.expireRequest': async ({ id }) => ({ expired: await interaction.expirePermissionRequest(id) }),
      'interaction.expireOld': async ({ maxAgeMs }) => ({ count: await interaction.expireOldPermissionRequests(maxAgeMs) }),
      'interaction.cancelBySession': async ({ sessionId }) => ({ count: await interaction.cancelPendingRequestsBySession(sessionId) }),
      'interaction.listBySession': ({ sessionId }) => interaction.listPendingAsksBySession(sessionId),
      'interaction.listByRoot': ({ rootSessionId }) => interaction.listPendingAsksByRootSession(rootSessionId),
      'interaction.listRequestsByRoot': ({ rootSessionId }) => interaction.listPendingRequestsByRootSession(rootSessionId),
      'interaction.matchGrant': params => interaction.matchGrant(params),
      'interaction.createGrant': params => interaction.createGrantFromOptions(params as Parameters<InteractionHost['createGrantFromOptions']>[0]),

      'workspace.resolveRoot': async (options) => {
        const resolved = await services.resolveSessionWorkspace(options);
        const knowledgeRoot = resolved.workspacePath && services.knowledgeRoot?.(resolved.workspacePath);
        return knowledgeRoot ? { ...resolved, knowledgeRoot } : resolved;
      },
      'workspace.addRoot': async ({ workspaceId, path }) => ({ changed: await services.addWorkspaceRoot(workspaceId, path) }),
      'workspace.removeRoot': async ({ workspaceId, path }) => ({ changed: await services.removeWorkspaceRoot(workspaceId, path) }),
    },
    notifications: {
      deliver: ({ audience, message }) => route(audience, message),
      'host.notify': (event) => {
        switch (event.kind) {
          case 'turn.finished':
            services.notifyTurnFinished(event.message as AssistantMessage, event.sessionId);
            break;
          case 'permission.required':
            void interaction.notifyPermissionRequired(event.requestId, event.rootSessionId);
            break;
          case 'files.changed':
            services.notifyFilesChanged?.(event.sessionId);
            break;
          case 'worktree.changed':
            services.notifyWorktreeChanged?.(event.worktreeId);
            break;
        }
      },
    },
  };
}
