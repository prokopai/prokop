import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import type { ProkopaiClient } from '@prokopai/sdk';
import { WorkspaceSettingsEditor, workspaceSettingsDraft, type WorkspaceSettingsDraft, type WorkspaceSettingsSection } from './WorkspaceSettingsEditor';
import { createFakeSdkClient, emitClientEvent, withAppContexts } from '../../../../.storybook/harness';
import { withServerDataStore } from '../../../../.storybook/mocks/storeDecorators';
import { createWorkspace } from '../../../../.storybook/mocks/mockWorkspace';
import { createPreconfigList } from '../../../../.storybook/mocks/mockPreconfig';
import { createLearningSettings, createPermissionGrantList } from '../../../../.storybook/mocks/mockSettings';

/**
 * One workspace's settings section with its draft and save bar: General,
 * MCP, Permissions, Memory & Learning. Permissions arrive over the
 * WebSocket; the fake client answers `permissions.list` with an event.
 */

const preconfigs = createPreconfigList();
const workspace = createWorkspace({ id: 'ws-1', name: 'my-project', path: '/home/user/my-project', additionalPaths: ['/home/user/my-project-docs'], settings: { memory: { enabled: true, permissionRisk: 'low' }, learning: createLearningSettings({ reviewers: [{ id: 'rev-1', preconfigId: preconfigs[1]?.id ?? '', instructions: '', modelOverride: null, cadence: null }] }), permissionMode: 'extended' } });

function clientWithGrants(grants = createPermissionGrantList()): ProkopaiClient {
  // `list` runs after construction, so the closure sees the finished client.
  const client: ProkopaiClient = createFakeSdkClient({ workspace, namespaces: { permissions: { list: (workspaceId: string) => { queueMicrotask(() => emitClientEvent(client, 'permission.list', workspaceId, grants)); } } } });
  return client;
}

interface Args { section: WorkspaceSettingsSection; isSaving: boolean; dirty: boolean; onSave: () => void; onSavePermissionMode: () => void; onDiscard: () => void }

function Harness({ section, isSaving, dirty, onSave, onSavePermissionMode, onDiscard }: Args) {
  const [client] = useState(() => clientWithGrants());
  const [draft, setDraft] = useState<WorkspaceSettingsDraft>(() => ({ ...workspaceSettingsDraft(workspace), ...(dirty ? { sessionTagOrder: 'untagged-first' as const } : {}) }));
  return (
    <WorkspaceSettingsEditor
      section={section}
      workspace={workspace}
      sdkClient={client}
      draft={draft}
      onChange={setDraft}
      onSave={onSave}
      onSavePermissionMode={onSavePermissionMode}
      onDiscard={() => { setDraft(workspaceSettingsDraft(workspace)); onDiscard(); }}
      isSaving={isSaving}
    />
  );
}

const meta = {
  title: 'Settings/WorkspaceSettingsEditor',
  parameters: { layout: 'padded' },
  args: { section: 'general', isSaving: false, dirty: false, onSave: fn(), onSavePermissionMode: fn(), onDiscard: fn() },
  render: (args) => <Harness {...args} />,
  decorators: [withServerDataStore({ workspaces: [workspace], preconfigs }), withAppContexts({ client: { workspace } }), (Story) => <div className="h-[40rem] w-[40rem] overflow-auto rounded-xl border bg-background"><Story /></div>],
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<Args>;

export const General: Story = {};
export const GeneralDirty: Story = { args: { dirty: true } };
export const GeneralSaving: Story = { args: { dirty: true, isSaving: true } };
export const Mcp: Story = { args: { section: 'mcp' } };
export const Permissions: Story = { args: { section: 'permissions' } };
export const Learning: Story = { args: { section: 'learning' } };
