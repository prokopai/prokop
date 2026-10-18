import type { ComponentType } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { ServerDialogs } from './ServerDialogs';
import { useUIStore } from '@/stores/uiStore';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { createFakeSdkClient, workspaceScene, SCENE_WORKSPACE } from '../../../.storybook/harness';
import { filePreviewPresets } from '../../../.storybook/mocks/mockGit';
import { scheduledJobPresets } from '../../../.storybook/mocks/mockSidebar';

/** The dialogs the shell can show at any time, driven by the UI store: settings, scheduled job, file preview. */

const client = createFakeSdkClient({ workspace: SCENE_WORKSPACE });

function withUI(state: Partial<ReturnType<typeof useUIStore.getState>>) {
  return function UIDecorator(Story: ComponentType) {
    useUIStore.setState({ showSettings: false, showSchedulerJob: false, editingSchedulerJob: null, filePreviewTarget: null, ...state });
    return <Story />;
  };
}

const meta = {
  title: 'Shell/ServerDialogs',
  component: ServerDialogs,
  parameters: { layout: 'fullscreen' },
  args: { apiToken: 'pkd_3f9a2c7e1b4d8e6f', isConnected: true, sdkClient: client, onLogout: fn(), onConfigurationClose: fn() },
  decorators: [(Story) => <ThemeProvider storageKey="storybook-theme"><div className="h-screen bg-background"><Story /></div></ThemeProvider>, ...workspaceScene({ workspace: SCENE_WORKSPACE, contexts: { client: { workspace: SCENE_WORKSPACE } } })],
} satisfies Meta<typeof ServerDialogs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Nothing: Story = { decorators: [withUI({})] };
export const Settings: Story = { decorators: [withUI({ showSettings: true, configurationSection: 'appearance' })] };
export const NewScheduledJob: Story = { decorators: [withUI({ showSchedulerJob: true })] };
export const EditScheduledJob: Story = { decorators: [withUI({ showSchedulerJob: true, editingSchedulerJob: scheduledJobPresets.active })] };
export const FilePreview: Story = { decorators: [withUI({ filePreviewTarget: { workspaceId: SCENE_WORKSPACE.id, path: filePreviewPresets.code.path, name: 'session.ts' } })] };
