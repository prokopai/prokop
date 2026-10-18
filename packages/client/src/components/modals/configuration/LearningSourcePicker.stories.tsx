import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { LearningSourcePicker } from './LearningSourcePicker';
import { createWorkspace } from '../../../../.storybook/mocks/mockWorkspace';

/** Picks which workspaces an agent home learns from. */

const workspaces = ['app', 'infra', 'docs', 'scratch', 'legacy'].map((name) => createWorkspace({ id: `ws-${name}`, name, path: `/home/user/${name}` }));

function Harness({ initial, onChange }: { initial: string[]; onChange: (ids: string[]) => void }) {
  const [ids, setIds] = useState(initial);
  return <div className="w-80"><LearningSourcePicker workspaces={workspaces} selectedIds={ids} onChange={(next) => { setIds(next); onChange(next); }} /></div>;
}

const meta = {
  title: 'Settings/LearningSourcePicker',
  parameters: { layout: 'centered' },
  args: { onChange: fn() },
} satisfies Meta<{ onChange: (ids: string[]) => void }>;

export default meta;
type Story = StoryObj<{ onChange: (ids: string[]) => void }>;

export const SomeSelected: Story = { render: ({ onChange }) => <Harness initial={['ws-app', 'ws-infra']} onChange={onChange} /> };
export const NoneSelected: Story = { render: ({ onChange }) => <Harness initial={[]} onChange={onChange} /> };
