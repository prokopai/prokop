import { useCallback } from 'react';
import type { ProkopaiClient, Session } from '@prokopai/sdk';
import { AgentChip } from './AgentChip';
import { ModelChip } from './ModelChip';
import { useSessionModelSelection } from '@/hooks/useSessionModelSelection';
import { useScopedServerData } from '@/contexts/HostScopeContext';
import { useOptionalSessionCommands } from '@/contexts/SessionCommandsContext';
import { getWorkspacePreconfigs } from '@/lib/workspacePreconfigs';

interface SessionModelChipsProps {
  session: Session;
  sdkClient: ProkopaiClient | null;
  disabled?: boolean;
}

/**
 * The agent and model chips for one session, wired to the catalogs and the
 * session commands. They sit at the right of the session header: what the
 * session is. Checkout, permissions and format stay under the composer.
 */
export function SessionModelChips({ session, sdkClient, disabled }: SessionModelChipsProps) {
  const commands = useOptionalSessionCommands();
  const allPreconfigs = useScopedServerData((s) => s.preconfigs);
  const agents = useScopedServerData((s) => s.agents);
  const models = useScopedServerData((s) => s.models);
  const workspace = useScopedServerData((s) => s.workspaces.find((w) => w.id === session.workspaceId) ?? null);
  const preconfigs = getWorkspacePreconfigs(workspace, allPreconfigs);
  const lockAgent = !!workspace?.settings?.isAgentHome;
  const model = useSessionModelSelection({ session, sdkClient, preconfigs });

  const selectPreconfig = useCallback((preconfigId: string) => {
    if (commands) commands.updateSessionPreconfigForSession(session.id, preconfigId);
    else sdkClient?.sessions.update(session.id, { preconfigId });
  }, [commands, sdkClient, session.id]);

  const pinnedModelName = useCallback((preconfig: { model: string | null; provider: string | null }) => {
    if (!preconfig.model) return null;
    const found = preconfig.provider
      ? models.find((m) => m.providerId === preconfig.provider && m.id === preconfig.model)
      : models.find((m) => m.id === preconfig.model);
    return found?.name ?? preconfig.model;
  }, [models]);

  const hasAgents = preconfigs.length > 0;
  const hasModels = model.groups.length > 0 || !!model.selection;
  if (!hasAgents && !hasModels) return null;

  return (
    <>
      {hasAgents && (
        <AgentChip
          preconfigs={preconfigs}
          agentIds={agents.map((a) => a.id)}
          selectedId={session.preconfigId}
          locked={lockAgent}
          disabled={disabled || model.disabled}
          pinnedModelName={pinnedModelName}
          onSelect={selectPreconfig}
        />
      )}
      {hasModels && (
        <ModelChip
          groups={model.groups}
          selection={model.selection}
          recent={model.recent}
          canSwitchHarness={model.canSwitchHarness}
          pinnedBy={model.pinnedBy}
          disabled={disabled || model.disabled}
          onSelectModel={model.selectModel}
          onSelectEffort={model.selectEffort}
        />
      )}
    </>
  );
}
