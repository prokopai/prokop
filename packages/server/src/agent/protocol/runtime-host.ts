import type { AgentEndpoint, Audience } from '@prokopai/agent-protocol';
import type { AutoApproveSeverity, ServerMessage } from '@prokopai/sdk/types';
import type { WorkspaceCapabilityHost } from '@prokopai/core/infrastructure/filesystem/workspace-policy/contracts';
import type { RuntimeDelivery } from '@prokopai/core/infrastructure/runtime/events';
import type {
  PendingAskRecord, RuntimeHost, TitleHost, ToolPolicyHost, WorkspaceCapabilityBindings,
} from '@prokopai/core/infrastructure/runtime/host';
import { nextDeliverSeq } from './deliver-seq';

type ToolWorkspaceOptions = Parameters<WorkspaceCapabilityBindings['createToolWorkspaceHost']>[0];

/** Persists extra workspace roots on the host. */
export interface WorkspaceRootPersistence {
  add(workspaceId: string, path: string): Promise<boolean>;
  remove(workspaceId: string, path: string): Promise<boolean>;
}

/** Runtime-host pieces that stay in the agent: pure logic, LLM calls, local paths. */
export interface AgentRuntimeHostLocal {
  titles: TitleHost;
  toolPolicy?: ToolPolicyHost;
  layout?: RuntimeHost['layout'];
  guidance?: RuntimeHost['guidance'];
  /** Host settings the agent used to read synchronously (the `initialize` settings). */
  isSandboxActive(): boolean;
  getPermissionTimeoutMs(): number;
  /** Deprecated severity shim. Absent means inherited, which fails closed. */
  autoApproveSeverity?(sessionId: string): Promise<AutoApproveSeverity | undefined>;
  /** Builds the tool workspace locally; `roots` persists root changes over the protocol. */
  createToolWorkspaceHost(options: ToolWorkspaceOptions, roots: WorkspaceRootPersistence): WorkspaceCapabilityHost;
  /** Sees the knowledge root the host reported for each resolved session root. */
  onResolvedRoot?(workspacePath: string, knowledgeRoot: string): void;
  /** Maps a runtime delivery to its wire form; null drops it, as host delivery does. */
  toWire(delivery: RuntimeDelivery): { audience: Audience; message: ServerMessage } | null;
}

/**
 * Agent side of the runtime-host protocol: a `RuntimeHost` whose host
 * capabilities are requests and notifications. Pending asks, grants, root
 * resolution and broadcasts go to the host; permission waiters and validation
 * stay in the agent (plan decision 6 A).
 */
export function createProtocolRuntimeHost(endpoint: AgentEndpoint, local: AgentRuntimeHostLocal): RuntimeHost {
  const request = endpoint.request.bind(endpoint);
  const roots: WorkspaceRootPersistence = {
    add: async (workspaceId, path) => (await request('workspace.addRoot', { workspaceId, path })).changed,
    remove: async (workspaceId, path) => (await request('workspace.removeRoot', { workspaceId, path })).changed,
  };
  const asRecord = (record: unknown): PendingAskRecord => record as PendingAskRecord;
  const asRecords = (records: unknown[]): PendingAskRecord[] => records as PendingAskRecord[];

  return {
    interaction: {
      createPendingAsk: async record => (await request('interaction.createPendingAsk', { record })).id,
      removePendingAsk: async (id) => {
        await request('interaction.removePendingAsk', { id });
      },
      removePendingAsksByToolCallId: async (toolCallId) => {
        await request('interaction.removeByToolCallId', { toolCallId });
      },
      getPermissionRequestByRequestId: async (requestId) => {
        const record = await request('interaction.getRequest', { requestId });
        return record ? asRecord(record) : null;
      },
      resolvePermissionRequestByRequestId: async (requestId, status, resolution) =>
        (await request('interaction.resolveRequest', { requestId, status, resolution })).resolved,
      expirePermissionRequest: async id => (await request('interaction.expireRequest', { id })).expired,
      expireOldPermissionRequests: async maxAgeMs => (await request('interaction.expireOld', { maxAgeMs })).count,
      cancelPendingRequestsBySession: async sessionId => (await request('interaction.cancelBySession', { sessionId })).count,
      listPendingAsksBySession: async sessionId => asRecords(await request('interaction.listBySession', { sessionId })),
      listPendingAsksByRootSession: async rootSessionId => asRecords(await request('interaction.listByRoot', { rootSessionId })),
      listPendingRequestsByRootSession: async rootSessionId =>
        asRecords(await request('interaction.listRequestsByRoot', { rootSessionId })),
      matchGrant: params => request('interaction.matchGrant', params),
      createGrantFromOptions: params => request('interaction.createGrant', {
        ...params, grantOptions: { ...params.grantOptions },
      }),
      ...(local.autoApproveSeverity ? { getSessionAutoApproveSeverity: local.autoApproveSeverity } : {}),
      getPermissionTimeoutMs: () => local.getPermissionTimeoutMs(),
      notifyPermissionRequired: async (requestId, rootSessionId) => {
        endpoint.notify('host.notify', { kind: 'permission.required', requestId, rootSessionId });
      },
    },
    delivery: {
      emit(delivery) {
        if (delivery.event.kind === 'terminal') {
          endpoint.notify('host.notify', {
            kind: 'turn.finished', sessionId: delivery.event.sessionId, message: delivery.event.message,
          });
          return;
        }
        const wire = local.toWire(delivery);
        if (wire) endpoint.notify('deliver', { seq: nextDeliverSeq(endpoint), audience: wire.audience, message: wire.message });
      },
    },
    titles: local.titles,
    workspace: {
      resolveSessionWorkspace: async (options) => {
        const { knowledgeRoot, ...resolved } = await request('workspace.resolveRoot', options);
        if (resolved.workspacePath && knowledgeRoot) local.onResolvedRoot?.(resolved.workspacePath, knowledgeRoot);
        return resolved;
      },
      createToolWorkspaceHost: options => local.createToolWorkspaceHost(options, roots),
    },
    ...(local.toolPolicy ? { toolPolicy: local.toolPolicy } : {}),
    sandbox: { isSandboxActive: () => local.isSandboxActive() },
    ...(local.layout ? { layout: local.layout } : {}),
    ...(local.guidance ? { guidance: local.guidance } : {}),
  };
}
