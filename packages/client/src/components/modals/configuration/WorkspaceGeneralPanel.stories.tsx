import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { WorkspaceGeneralPanel } from './WorkspaceGeneralPanel';
import type { SessionTagOrder } from '@/lib/sessionTagOrder';
import { createFakeSdkClient } from '../../../../.storybook/harness';
import { createWorkspace } from '../../../../.storybook/mocks/mockWorkspace';
import { createPreconfigList } from '../../../../.storybook/mocks/mockPreconfig';

/** Workspace General settings: default agent, session order, additional paths. */

const workspace = createWorkspace({ id: 'ws-1', name: 'my-project', path: '/home/user/my-project' });
const preconfigs = createPreconfigList();

interface Args { paths: string[]; order: SessionTagOrder; defaultAgentId: string | null; onChange: (value: unknown) => void }

function Harness(args: Args) {
  const [paths, setPaths] = useState(args.paths);
  const [order, setOrder] = useState(args.order);
  const [agent, setAgent] = useState(args.defaultAgentId);
  return (
    <WorkspaceGeneralPanel
      workspace={workspace}
      sdkClient={createFakeSdkClient()}
      paths={paths}
      onPathsChange={(next) => { setPaths(next); args.onChange(next); }}
      order={order}
      onChange={(next) => { setOrder(next); args.onChange(next); }}
      preconfigs={preconfigs}
      defaultAgentId={agent}
      onDefaultAgentChange={(next) => { setAgent(next); args.onChange(next); }}
    />
  );
}

const meta = {
  title: 'Settings/WorkspaceGeneralPanel',
  parameters: { layout: 'padded' },
  args: { paths: ['/home/user/my-project-docs'], order: 'tagged-first', defaultAgentId: null, onChange: fn() },
  render: (args) => <Harness {...args} />,
  decorators: [(Story) => <div className="w-[36rem] rounded-xl border bg-background"><Story /></div>],
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<Args>;

export const ServerDefaultAgent: Story = {};
export const PinnedAgent: Story = { args: { defaultAgentId: preconfigs[1]?.id ?? null, order: 'untagged-first' } };
export const NoExtraPaths: Story = { args: { paths: [] } };
