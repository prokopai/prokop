import type { HarnessAskStore } from '@/infrastructure/runtime/harness-asks';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { createPendingAsk, expirePermissionRequest, resolvePermissionRequestByRequestId } from '@/infrastructure/sqlite/pending-asks';
import { createGrantFromOptions, matchGrant } from '@/infrastructure/sqlite/permissions';
import { getControllerConnections, isControlled } from '@/transport/websocket/control-registry';

/** In-process harness ask store: SQLite rows and grants, WebSocket control state. */
export const localHarnessAsks: HarnessAskStore = {
  createPendingAsk: async record => createPendingAsk(record),
  expireRequest: async (id) => {
    expirePermissionRequest(id);
  },
  resolveRequest: async (requestId, status, resolution, grant) => {
    try {
      return getDatabase().transaction(() => {
        if (!resolvePermissionRequestByRequestId(requestId, status, resolution)) return { resolved: false, status };
        if (status === 'approved' && grant && !createGrantFromOptions(grant)) throw new Error('Grant was not stored');
        return { resolved: true, status };
      })();
    } catch {
      // The failed grant rolled the approval back. Never accept without its requested scope.
      return { resolved: resolvePermissionRequestByRequestId(requestId, 'denied', resolution), status: 'denied' };
    }
  },
  matchGrant: async params => matchGrant(params),
  sessionControl: async sessionId => ({
    controlled: isControlled(sessionId),
    connected: isControlled(sessionId) && getControllerConnections(sessionId).length > 0,
  }),
};
