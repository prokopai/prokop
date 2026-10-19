import { Suspense, lazy, type ReactElement } from 'react';
import type { Preconfig, ProkopaiClient, Workspace } from '@prokopai/sdk';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsGroup } from '@/components/ui/settings-group';
import { SettingsRow } from '@/components/ui/settings-row';
import { SESSION_TAG_ORDERS, isSessionTagOrder, type SessionTagOrder } from '@/lib/sessionTagOrder';
import { LoadingState } from '@/components/shared/States';
import { DisclosureRow } from './DisclosureRow';

const AdditionalPathsPanel = lazy(() => import('./AdditionalPathsPanel').then(m => ({ default: m.AdditionalPathsPanel })));

interface WorkspaceGeneralPanelProps {
  workspace: Workspace;
  sdkClient: ProkopaiClient | null;
  paths: string[];
  onPathsChange: (paths: string[]) => void;
  order: SessionTagOrder;
  onChange: (order: SessionTagOrder) => void;
  /** Primary/both preconfigs eligible as the workspace default agent. */
  preconfigs: Preconfig[];
  /** Current default agent id, or null for the server default. */
  defaultAgentId: string | null;
  onDefaultAgentChange: (id: string | null) => void;
}

export function WorkspaceGeneralPanel({
  workspace,
  sdkClient,
  paths,
  onPathsChange,
  order,
  onChange,
  preconfigs,
  defaultAgentId,
  onDefaultAgentChange,
}: WorkspaceGeneralPanelProps): ReactElement {
  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4">
      <SettingsGroup label="Sessions">
        <SettingsRow label="Default agent" htmlFor="default-agent" description="Used for new chats here. All agents stay available in the chat picker.">
          <Select
            value={defaultAgentId ?? '__server__'}
            onValueChange={value => onDefaultAgentChange(value === '__server__' ? null : value)}
          >
            <SelectTrigger id="default-agent" className="w-full sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="__server__">Server default</SelectItem>
                {preconfigs.map(preconfig => (
                  <SelectItem key={preconfig.id} value={preconfig.id}>{preconfig.name}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow label="Session order" htmlFor="session-tag-order" description="Tagged groups above or below untagged sessions. Each group keeps its own order.">
          <Select value={order} onValueChange={value => { if (isSessionTagOrder(value)) onChange(value); }}>
            <SelectTrigger id="session-tag-order" className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {SESSION_TAG_ORDERS.map(option => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup label="Files" description={`Directories the agent can use alongside ${workspace.name}, by absolute path.`}>
        <DisclosureRow label="Additional paths" summary={`${paths.length} path${paths.length === 1 ? '' : 's'}`} defaultOpen={false}>
          <Suspense fallback={<LoadingState />}>
            <AdditionalPathsPanel workspace={workspace} sdkClient={sdkClient} paths={paths} onChange={onPathsChange} />
          </Suspense>
        </DisclosureRow>
      </SettingsGroup>
    </div>
  );
}
