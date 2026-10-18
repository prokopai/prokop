import type { Meta, StoryObj } from '@storybook/react-vite';
import { WorkspaceHeader } from './WorkspaceHeader';
import { workspaceScene, SCENE_SESSION, STORY_ROUTES } from '../../../.storybook/harness';
import { createSession } from '../../../.storybook/mocks/mockSession';

/**
 * The header above a conversation pane, fed from the stores: title, model
 * and preconfig pickers, token meter, compaction, stop.
 */

const meta = {
  title: 'Workspace/WorkspaceHeader',
  parameters: { layout: 'fullscreen' },
  render: () => <WorkspaceHeader />,
  decorators: [(Story) => <div className="bg-card px-2"><Story /></div>, ...workspaceScene()],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Streaming: Story = {
  decorators: workspaceScene({ streaming: true, sessions: [createSession({ ...SCENE_SESSION, runningAt: new Date().toISOString() })] }),
};

export const Compacting: Story = {
  decorators: workspaceScene({ sessions: [createSession({ ...SCENE_SESSION, compacting: true })] }),
};

export const Subagent: Story = {
  decorators: workspaceScene({ sessions: [createSession({ ...SCENE_SESSION, title: 'Subagent: explore', parentId: 'parent', agentName: 'explore', subagentStatus: 'running' })] }),
};

export const InOverview: Story = {
  decorators: workspaceScene({ route: STORY_ROUTES.overviewSession }),
};

export const NoSession: Story = {
  decorators: workspaceScene({ sessions: [], messages: [] }),
};

export const Phone: Story = {
  globals: { viewport: { value: 'phone' } },
};
