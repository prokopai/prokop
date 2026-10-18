import type { Meta, StoryObj } from '@storybook/react-vite';
import { FilesPanel } from './FilesPanel';
import { createFakeSdkClient, withMemoryRouter, STORY_ROUTES } from '../../../.storybook/harness';
import { createWorkspace } from '../../../.storybook/mocks/mockWorkspace';
import { withServerDataStore, withSessionStore } from '../../../.storybook/mocks/storeDecorators';
import { gitStatusPresets } from '../../../.storybook/mocks/mockGit';

/**
 * One repository view as a workspace tab: Explorer, Changes or Branches,
 * with the checkout picker above it. Reads the active workspace and the
 * focused session from the stores.
 */

const workspace = createWorkspace({ id: 'ws-1', name: 'my-project', path: '/home/user/my-project', additionalPaths: ['/home/user/my-project-docs'] });

const meta: Meta<typeof FilesPanel> = {
  title: 'Files & Git/FilesPanel',
  component: FilesPanel,
  parameters: {
    layout: 'fullscreen',
    smoke: 'skip: Pierre file tree is a custom element that measures rows; happy-dom has no layout',
  },
  args: { sdkClient: createFakeSdkClient({ workspace }), view: 'explorer' },
  decorators: [
    (Story) => <div className="flex h-screen w-80 flex-col border-r bg-sidebar text-sidebar-foreground"><Story /></div>,
    withMemoryRouter(STORY_ROUTES.workspace),
    withServerDataStore({ workspaces: [workspace], activeWorkspaceId: workspace.id }),
    withSessionStore({ sessions: [] }),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Explorer: Story = {};

export const Changes: Story = {
  args: { view: 'changes' },
};

export const ChangesClean: Story = {
  args: { view: 'changes', sdkClient: createFakeSdkClient({ workspace, http: { files: { gitStatus: async () => gitStatusPresets.clean } } }) },
};

export const Branches: Story = {
  args: { view: 'branches' },
};

export const NotARepository: Story = {
  args: { view: 'changes', sdkClient: createFakeSdkClient({ workspace, http: { files: { gitStatus: async () => gitStatusPresets.notARepo } } }) },
};

export const Offline: Story = {
  args: { sdkClient: null },
};
