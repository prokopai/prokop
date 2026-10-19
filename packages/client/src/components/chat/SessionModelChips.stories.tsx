import type { Meta, StoryObj } from '@storybook/react-vite';
import { SessionModelChips } from './SessionModelChips';
import { withServerDataStore, withSessionStore } from '../../../.storybook/mocks/storeDecorators';
import { createSession } from '../../../.storybook/mocks/mockSession';
import { createWorkspace } from '../../../.storybook/mocks/mockWorkspace';
import { createPreconfigList } from '../../../.storybook/mocks/mockPreconfig';

/** Agent and model chips wired to the store for one session. Catalog-backed harnesses need a live client, so only Prokop models show here. */

const workspace = createWorkspace({ name: 'my-project', path: '/home/user/my-project' });
const preconfigs = createPreconfigList();
const session = createSession({ workspaceId: workspace.id, preconfigId: preconfigs[0]?.id ?? null, selectedModel: 'claude-3.5-sonnet', selectedProvider: 'anthropic' });

const meta = {
  title: 'Chat/SessionModelChips',
  component: SessionModelChips,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => <div className="@container/chips flex w-[40rem] max-w-full gap-1.5"><Story /></div>,
    withServerDataStore({ workspaces: [workspace], activeWorkspaceId: workspace.id, preconfigs }),
    withSessionStore({ sessions: [session] }),
  ],
  args: { session, sdkClient: null },
} as Meta<typeof SessionModelChips>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const AgentHome: Story = {
  decorators: [withServerDataStore({
    workspaces: [{ ...workspace, settings: { ...workspace.settings, isAgentHome: true } }],
    activeWorkspaceId: workspace.id,
    preconfigs,
  })],
};

export const Disabled: Story = { args: { disabled: true } };
