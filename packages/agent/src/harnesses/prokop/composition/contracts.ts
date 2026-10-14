// Prokop harness ask resolution.
//
// Wire-side ask resolution must land in the same composed permission runtime
// that execution enters: the composed scope owns the live waiters, while the
// process-default runtime capek falls back to outside any scope holds none.
// Every call routes through the composed scope when the composition has
// resolved, so ask.response approval resolves the waiter the running tool is
// blocked on. Before the composition resolves no composed waiter can exist
// and the call runs unscoped unchanged.
//
// Bootstrap serves this implementation as the agent side of `ask.lookup` and
// `ask.resolve` (bootstrap/agent-asks.ts); transport and adapters never import it.

import {
  getAuthorityForPendingAsk as capekGetAuthorityForPendingAsk,
  getSessionIdForPendingAsk as capekGetSessionIdForPendingAsk,
  resolveAsk as capekResolveAsk,
} from '#agent/harnesses/prokop/permission/ask-user-api';
import type { AskAuthority } from '@prokopai/sdk';
import { withProkopComposedScopeSync } from './execution-scope';

export interface ProkopAskResolution {
  resolveAsk(toolCallId: string, response: unknown, requestId?: string): Promise<boolean>;
  getSessionIdForPendingAsk(toolCallId: string, requestId?: string): Promise<string | null>;
  getAuthorityForPendingAsk(toolCallId: string): AskAuthority | undefined;
}

export const prokopAskResolution: ProkopAskResolution = {
  resolveAsk(toolCallId, response, requestId) {
    return withProkopComposedScopeSync(() =>
      capekResolveAsk(toolCallId, response, requestId));
  },
  async getSessionIdForPendingAsk(toolCallId, requestId) {
    return withProkopComposedScopeSync(() =>
      capekGetSessionIdForPendingAsk(toolCallId, requestId));
  },
  getAuthorityForPendingAsk(toolCallId) {
    return withProkopComposedScopeSync(() =>
      capekGetAuthorityForPendingAsk(toolCallId));
  },
};
