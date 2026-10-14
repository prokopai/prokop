import type { Ask, AskAuthority, ClientCapability } from '@prokopai/sdk';

/** Most asks are answered by the session controller only. */
export const DEFAULT_ASK_AUTHORITY: AskAuthority = {
  visibilityScope: 'controller_only',
  resolutionMode: 'controller_only',
};

/**
 * Who may see and answer an ask, derived from the ask alone. The agent uses
 * it when it raises an ask; the host derives the same value from a stored
 * pending-ask row (reconnect sync) without asking the agent.
 */
export function resolveAskAuthority(request: Ask): AskAuthority {
  if (
    request.type === 'client_capability'
    && 'target' in request
    && request.target === 'client'
  ) {
    return {
      visibilityScope: 'global',
      resolutionMode: 'first_eligible',
      requiredCapabilities: [request.capability as ClientCapability],
    };
  }
  return DEFAULT_ASK_AUTHORITY;
}
