import { useState, type ComponentType } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useQueryClient } from '@tanstack/react-query';
import { fn } from 'storybook/test';
import { ConfigurationDialog } from './ConfigurationDialog';
import { useUIStore, type ConfigurationSection } from '@/stores/uiStore';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { ThemedToaster } from '@/components/providers/ThemedToaster';
import { resetServerUpdateNotices } from '@/hooks/useServerUpdate';
import { createFakeSdkClient, withAppContexts, STORY_SERVER_URL } from '../../../.storybook/harness';
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

/**
 * Seeds the server-update query with a newer release so the footer line, the
 * header dot and the toast all show without reaching GitHub. The toaster
 * mounts first so the toast raised on mount is not lost.
 */
function withServerUpdate(version: string) {
  return function ServerUpdateDecorator(Story: ComponentType) {
    const queryClient = useQueryClient();
    useState(() => {
      resetServerUpdateNotices();
      sessionStorage.removeItem(`prokop-update:${STORY_SERVER_URL}:${version}`);
      queryClient.setQueryData(['server-update', STORY_SERVER_URL], version);
      return true;
    });
    return <><ThemedToaster /><Story /></>;
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
/** A newer server release: footer line in the dialog plus the toast, the same wording in both. */
export const UpdateAvailable: Story = {
  parameters: { smoke: 'skip: sonner measures toast heights in a real browser' },
  decorators: [withSection('system'), withServerUpdate('1.25.0')],
};
export const Phone: Story = { decorators: [withSection('appearance')], globals: { viewport: { value: 'phone' } } };
