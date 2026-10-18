import type { Meta, StoryObj } from '@storybook/react-vite';
import { LearningHistory } from './LearningHistory';
import { withAppContexts } from '../../../../.storybook/harness';
import { withServerDataStore } from '../../../../.storybook/mocks/storeDecorators';
import { createWorkspace } from '../../../../.storybook/mocks/mockWorkspace';
import { createPreconfigList } from '../../../../.storybook/mocks/mockPreconfig';
import { createLearningSettings, createLearningRunDetail, createLearningRuns } from '../../../../.storybook/mocks/mockSettings';

/** Past learning runs of a workspace: status, learner, sources, changed files, undo. */

const preconfigs = createPreconfigList();
const workspace = createWorkspace({ id: 'ws-1', name: 'my-project', path: '/home/user/my-project', settings: { learning: createLearningSettings({ reviewers: [{ id: 'rev-1', preconfigId: preconfigs[1]?.id ?? '', instructions: '', modelOverride: null, cadence: null }] }) } });

function withRuns(runs = createLearningRuns(), blocked = false) {
  return withAppContexts({ client: { http: { workspaces: { learningRuns: async () => ({ runs, blocked }), learningRun: async (_id, runId) => createLearningRunDetail({ run: runs.find((run) => run.id === runId) ?? runs[0]! }) } } } });
}

const meta = {
  title: 'Settings/LearningHistory',
  component: LearningHistory,
  parameters: { layout: 'padded' },
  args: { workspaceId: workspace.id },
  decorators: [withServerDataStore({ workspaces: [workspace], preconfigs }), (Story) => <div className="h-[32rem] w-[40rem] overflow-auto rounded-xl border bg-background"><Story /></div>],
} satisfies Meta<typeof LearningHistory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  decorators: [withRuns()],
};

export const Blocked: Story = {
  decorators: [withRuns(createLearningRuns(), true)],
};

export const NoRuns: Story = {
  decorators: [withRuns([])],
};

export const Loading: Story = {
  decorators: [withAppContexts({ client: { latencyMs: 60_000 } })],
};

export const Failed: Story = {
  decorators: [withAppContexts({ client: { http: { workspaces: { learningRuns: async () => { throw new Error('Learning store is locked'); } } } } })],
};
