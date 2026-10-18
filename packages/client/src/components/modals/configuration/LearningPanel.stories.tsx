import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import type { WorkspaceLearningSettings } from '@prokopai/sdk';
import { LearningPanel } from './LearningPanel';
import { withAppContexts } from '../../../../.storybook/harness';
import { withServerDataStore } from '../../../../.storybook/mocks/storeDecorators';
import { createWorkspace } from '../../../../.storybook/mocks/mockWorkspace';
import { createPreconfigList } from '../../../../.storybook/mocks/mockPreconfig';
import { createLearningSettings } from '../../../../.storybook/mocks/mockSettings';

/**
 * Memory and learning for a workspace or agent home: enable, learners with
 * instructions, model and cadence, sources, prompt preview, history.
 */

const preconfigs = createPreconfigList();
const workspace = createWorkspace({ id: 'ws-1', name: 'my-project', path: '/home/user/my-project', settings: { learning: createLearningSettings({ reviewers: [{ id: 'rev-1', preconfigId: preconfigs[1]?.id ?? '', instructions: '', modelOverride: null, cadence: null }] }) } });
const agentHome = createWorkspace({ id: 'ws-agent', name: 'reviewer', path: '/home/user/.prokopai/agents/reviewer', settings: { isAgentHome: true, agentId: preconfigs[1]?.id } });

interface Args { workspace: typeof workspace; value: WorkspaceLearningSettings | undefined; allowPersonalLearning: boolean; onChange: (value: WorkspaceLearningSettings) => void; onPersonalLearningChange: (value: boolean) => void }

function Harness(args: Args) {
  const [value, setValue] = useState(args.value);
  const [personal, setPersonal] = useState(args.allowPersonalLearning);
  return (
    <LearningPanel
      workspace={args.workspace}
      preconfigs={preconfigs}
      value={value}
      allowPersonalLearning={personal}
      onChange={(next) => { setValue(next); args.onChange(next); }}
      onPersonalLearningChange={(next) => { setPersonal(next); args.onPersonalLearningChange(next); }}
    />
  );
}

const meta = {
  title: 'Settings/LearningPanel',
  parameters: { layout: 'padded' },
  args: { workspace, value: workspace.settings?.learning, allowPersonalLearning: true, onChange: fn(), onPersonalLearningChange: fn() },
  render: (args) => <Harness {...args} />,
  decorators: [withServerDataStore({ workspaces: [workspace, agentHome], preconfigs }), withAppContexts(), (Story) => <div className="h-[40rem] w-[40rem] overflow-auto rounded-xl border bg-background"><Story /></div>],
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<Args>;

export const Enabled: Story = {};

export const Disabled: Story = {
  args: { value: createLearningSettings({ enabled: false, reviewers: [] }) },
};

export const NeverConfigured: Story = {
  args: { value: undefined },
};

export const SeveralLearners: Story = {
  args: {
    value: createLearningSettings({
      reviewers: [
        { id: 'rev-1', preconfigId: preconfigs[1]?.id ?? '', instructions: 'Focus on review habits.', modelOverride: null, cadence: null },
        { id: 'rev-2', preconfigId: preconfigs[2]?.id ?? '', instructions: '', modelOverride: { providerId: '', modelId: 'claude-opus-4-1', variant: 'high', harness: 'claude-cli' }, cadence: { idleMinutes: 15, minimumIntervalMinutes: 60, maximumPendingMinutes: 480 } },
        { id: 'rev-3', preconfigId: 'missing-preconfig', instructions: '', modelOverride: null, cadence: null },
      ],
    }),
  },
};

export const AgentHome: Story = {
  args: { workspace: agentHome, value: createLearningSettings({ sources: { mode: 'selected', workspaceIds: ['ws-1'] } }) },
};

export const PersonalLearningOff: Story = {
  args: { allowPersonalLearning: false },
};
