import type { Meta, StoryObj } from '@storybook/react-vite';
import { AppHeader } from './AppHeader';
import { workspaceScene, STORY_ROUTES } from '../../../.storybook/harness';

/**
 * The title bar: server switcher, Workspace / Overview switch, dock toggles
 * and settings. On phones it collapses to a compact row with a view menu.
 */

const meta = {
  title: 'Workspace/AppHeader',
  component: AppHeader,
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div className="bg-background px-2"><Story /></div>, ...workspaceScene()],
} satisfies Meta<typeof AppHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Workspace: Story = {};

export const Overview: Story = {
  decorators: workspaceScene({ route: STORY_ROUTES.overview }),
};

export const Phone: Story = {
  globals: { viewport: { value: 'phone' } },
};
