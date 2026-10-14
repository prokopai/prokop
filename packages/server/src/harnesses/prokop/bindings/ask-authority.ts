import { ASK_TIMEOUT } from '@/harnesses/prokop/permission/ask-user-api';
import { resolveAskAuthority } from '@prokopai/core/domains/permissions/ask-authority';
import type { AskAuthorityPort } from '@prokopai/core/application/ports/session';

/**
 * Ask authority adapter (S3): the ask timeout, and authority derived from a
 * stored ask with the same pure rule the agent applies when it raises it, so
 * reconnect sync never asks the agent.
 */
export function createProkopAskAuthorityPort(): AskAuthorityPort {
  return {
    timeoutMs: ASK_TIMEOUT,
    authorityOf: resolveAskAuthority,
  };
}
