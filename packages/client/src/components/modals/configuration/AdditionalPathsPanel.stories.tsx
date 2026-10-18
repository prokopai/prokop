import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { AdditionalPathsPanel } from './AdditionalPathsPanel';
import { createFakeSdkClient } from '../../../../.storybook/harness';
import { createWorkspace } from '../../../../.storybook/mocks/mockWorkspace';

/** Extra folders a workspace can read: list, add through the folder picker, remove. */

const workspace = createWorkspace({ id: 'ws-1', name: 'my-project', path: '/home/user/my-project' });

interface Args { initial: string[]; onChange: (paths: string[]) => void; offline?: boolean }

function Harness({ initial, onChange, offline }: Args) {
  const [paths, setPaths] = useState(initial);
  return <AdditionalPathsPanel workspace={workspace} paths={paths} onChange={(next) => { setPaths(next); onChange(next); }} sdkClient={offline ? null : createFakeSdkClient()} />;
}

const meta = {
  title: 'Settings/AdditionalPathsPanel',
  parameters: { layout: 'padded' },
  args: { initial: ['/home/user/my-project-docs', '/home/user/shared-lib'], onChange: fn() },
  render: (args) => <Harness {...args} />,
  decorators: [(Story) => <div className="w-[36rem] rounded-xl border bg-background p-4"><Story /></div>],
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<Args>;

export const WithPaths: Story = {};
export const NoPaths: Story = { args: { initial: [] } };
export const Offline: Story = { args: { offline: true } };
