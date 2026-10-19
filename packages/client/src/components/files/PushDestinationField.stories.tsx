import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';
import { Button } from '@/components/ui/button';
import { PushDestinationField } from './PushDestinationField';

/**
 * The push target as one field: a muted `origin /` prefix with a single
 * remote, a borderless select segment with several.
 */

const meta = {
  title: 'Files & Git/PushDestinationField',
  component: PushDestinationField,
  parameters: { layout: 'centered' },
  args: { remotes: ['origin'], remote: 'origin', branch: 'main', onRemoteChange: fn(), onBranchChange: fn() },
  decorators: [(Story) => <div className="w-80 border bg-sidebar p-3 text-sidebar-foreground"><Story /></div>],
} satisfies Meta<typeof PushDestinationField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SingleRemote: Story = {};

export const SeveralRemotes: Story = {
  render: function SeveralRemotesRender(args) {
    const [remote, setRemote] = useState('upstream');
    const [branch, setBranch] = useState('feature/login');
    return <PushDestinationField {...args} remotes={['origin', 'upstream', 'fork']} remote={remote} branch={branch} onRemoteChange={setRemote} onBranchChange={setBranch} />;
  },
};

export const NoRemotes: Story = {
  args: { remotes: [], remote: '', branch: 'main' },
};

export const Disabled: Story = {
  args: { disabled: true },
};

/** The branches panel layout: the field and Review push share a line and wrap when narrow. */
export const WithReviewButton: Story = {
  render: (args) => <div className="flex flex-wrap items-center gap-2">
    <PushDestinationField {...args} className="min-w-40" />
    <Button variant="outline" className="ml-auto">Review push</Button>
  </div>,
};
