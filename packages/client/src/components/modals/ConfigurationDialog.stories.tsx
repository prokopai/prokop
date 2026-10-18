import type { ComponentType } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { ConfigurationDialog } from './ConfigurationDialog';
import { useUIStore, type ConfigurationSection } from '@/stores/uiStore';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { createFakeSdkClient, withAppContexts } from '../../../.storybook/harness';
import { withServerDataStore } from '../../../.storybook/mocks/storeDecorators';
import { createWorkspace } from '../../../.storybook/mocks/mockWorkspace';
import { createPreconfigList } from '../../../.storybook/mocks/mockPreconfig';

/**
 * The whole settings dialog with every section wired to the fake server.
 * Each story opens on one section; the nav switches between all of them.
 */

const workspace = createWorkspace({ id: 'ws-1', name: 'my-project', path: '/home/user/my-project' });
const client = createFakeSdkClient({ workspace });

function withSection(section: ConfigurationSection) {
  return function SectionDecorator(Story: ComponentType) {
    useUIStore.setState({ showSettings: true, configurationSection: section });
    return <Story />;
  };
}

const meta = {
  title: 'Dialogs/ConfigurationDialog',
  component: ConfigurationDialog,
  parameters: { layout: 'fullscreen' },
  args: { open: true, onOpenChange: fn(), sdkClient: client, apiToken: 'pkd_3f9a2c7e1b4d8e6f', isConnected: true, onLogout: fn() },
  decorators: [
    (Story) => <ThemeProvider storageKey="storybook-theme"><Story /></ThemeProvider>,
    withServerDataStore({ workspaces: [workspace], activeWorkspaceId: workspace.id, preconfigs: createPreconfigList() }),
    withAppContexts({ client: { workspace } }),
  ],
} satisfies Meta<typeof ConfigurationDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Appearance: Story = { decorators: [withSection('appearance')] };
export const Notifications: Story = { decorators: [withSection('notifications')] };
export const Keybinds: Story = { decorators: [withSection('keybinds')] };
export const WorkspaceGeneral: Story = { decorators: [withSection('workspace-general')] };
export const WorkspaceMcp: Story = { decorators: [withSection('workspace-mcp')] };
export const WorkspacePermissions: Story = { decorators: [withSection('workspace-permissions')] };
export const WorkspaceLearning: Story = { decorators: [withSection('workspace-learning')] };
export const McpServers: Story = { decorators: [withSection('mcp')] };
export const Harnesses: Story = { decorators: [withSection('harnesses')] };
export const Usage: Story = { decorators: [withSection('usage')] };
export const Devices: Story = { decorators: [withSection('devices')] };
export const Agents: Story = { decorators: [withSection('preconfigs')] };
export const Prompts: Story = { decorators: [withSection('prompts')] };
export const ProvidersModels: Story = { decorators: [withSection('providers-models')] };
export const ResponseFormats: Story = { decorators: [withSection('response-formats')] };
export const System: Story = { decorators: [withSection('system')] };
export const Disconnected: Story = { args: { sdkClient: null, isConnected: false, apiToken: null }, decorators: [withSection('system')] };
export const Phone: Story = { decorators: [withSection('appearance')], globals: { viewport: { value: 'phone' } } };
