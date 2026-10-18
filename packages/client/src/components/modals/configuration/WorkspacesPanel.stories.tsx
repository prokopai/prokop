import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { WorkspacesPanel } from './WorkspacesPanel';
import type { WorkspaceSettingsDraft, WorkspaceSettingsSection } from './WorkspaceSettingsEditor';
import { createFakeSdkClient, withAppContexts } from '../../../../.storybook/harness';
import { withServerDataStore } from '../../../../.storybook/mocks/storeDecorators';
import { createWorkspace } from '../../../../.storybook/mocks/mockWorkspace';
import { createPreconfigList } from '../../../../.storybook/mocks/mockPreconfig';

/** The workspace settings host: keeps one draft per workspace and saves through the session commands. */

const preconfigs = createPreconfigList();
const workspace = createWorkspace({ id: 'ws-1', name: 'my-project', path: '/home/user/my-project' });
const agentHome = createWorkspace({ id: 'ws-agent', name: 'reviewer', path: '/home/user/.prokopai/agents/reviewer', settings: { isAgentHome: true, agentId: preconfigs[1]?.id } });

interface Args { workspace: typeof workspace; section: WorkspaceSettingsSection }

function Harness({ workspace: target, section }: Args) {
  const [drafts, setDrafts] = useState<Record<string, WorkspaceSettingsDraft>>({});
  return <WorkspacesPanel workspace={target} section={section} sdkClient={createFakeSdkClient({ workspace: target })} drafts={drafts} setDrafts={setDrafts} />;
}

const meta = {
  title: 'Settings/WorkspacesPanel',
  parameters: { layout: 'padded' },
  args: { workspace, section: 'general' },
  render: (args) => <Harness {...args} />,
  decorators: [withServerDataStore({ workspaces: [workspace, agentHome], preconfigs }), withAppContexts({ client: { workspace } }), (Story) => <div className="h-[40rem] w-[40rem] overflow-auto rounded-xl border bg-background"><Story /></div>],
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<Args>;

export const General: Story = {};
export const Learning: Story = { args: { section: 'learning' } };
export const AgentHomeLearning: Story = { args: { workspace: agentHome, section: 'learning' } };
