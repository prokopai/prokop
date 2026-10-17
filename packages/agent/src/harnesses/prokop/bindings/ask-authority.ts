import { getPermissionTimeoutMs } from '@prokopai/core/infrastructure/runtime/environment';
import { resolveAskAuthority } from '@prokopai/core/domains/permissions/ask-authority';
import type { AskAuthorityPort } from '@prokopai/core/application/ports/session';

/**
 * Ask authority adapter (S3): how long an ask may wait for a person, and
 * authority derived from a stored ask with the same pure rule the agent
 * applies when it raises it, so reconnect sync never asks the agent.
 */
export function createProkopAskAuthorityPort(): AskAuthorityPort {
  return {
    // Approvals and questions wait this long; reconnect cleanup must not
    // expire them sooner (it once used the 5 minute client-capability limit).
    get timeoutMs() {
      return getPermissionTimeoutMs();
    },
    authorityOf: resolveAskAuthority,
  };
}
