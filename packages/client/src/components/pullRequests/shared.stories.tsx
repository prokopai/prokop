import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import {
  CopyButton,
  CopyCommand,
  PrError,
  PrSelect,
  PrStateBadge,
  PrStateIcon,
  StatusIcon,
  relativeTime,
} from './shared';

/** Small pieces the pull request views share: state badges, check icons, selects, copy buttons, errors. */

const states = [
  { state: 'open', draft: false },
  { state: 'open', draft: true },
  { state: 'merged', draft: false },
  { state: 'closed', draft: false },
] as const;

const checkStates = ['success', 'failure', 'pending', 'queued', 'skipped', 'cancelled', 'neutral', 'unknown'];

function SelectsDemo({ onChange }: { onChange: (value: string) => void }) {
  const [value, setValue] = useState('/home/user/app');
  const options = [
    { value: '/home/user/app', label: 'app' },
    { value: '/home/user/.prokopai/worktrees/feature-login', label: 'feature-login' },
    { value: '/home/user/.prokopai/worktrees/fix-auth-flow', label: 'fix-auth-flow' },
  ];
  return (
    <div className="flex flex-col gap-3">
      <PrSelect label="Checkout" value={value} onChange={(next) => { setValue(next); onChange(next); }} options={options} />
      <PrSelect compact label="Checkout" title={value} value={value} onChange={(next) => { setValue(next); onChange(next); }} options={options} />
      <PrSelect label="Disabled" value={value} onChange={onChange} options={options} disabled />
    </div>
  );
}

const meta = {
  title: 'Files & Git/PullRequestShared',
  parameters: { layout: 'padded' },
  args: { onChange: fn() },
} satisfies Meta<{ onChange: (value: string) => void }>;

export default meta;
type Story = StoryObj<{ onChange: (value: string) => void }>;

export const StateBadges: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {states.map((pr) => (
        <div key={`${pr.state}-${pr.draft}`} className="flex items-center gap-3 text-sm">
          <PrStateIcon pr={pr} className="size-4" />
          <PrStateBadge pr={pr} />
          <span className="text-muted-foreground">{pr.draft ? 'draft' : pr.state}</span>
        </div>
      ))}
    </div>
  ),
};

export const CheckIcons: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      {checkStates.map((state) => (
        <div key={state} className="flex items-center gap-3 text-sm"><StatusIcon state={state} /><span className="font-mono text-xs text-muted-foreground">{state}</span></div>
      ))}
    </div>
  ),
};

export const Selects: Story = {
  render: ({ onChange }) => <SelectsDemo onChange={onChange} />,
};

export const Copy: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-3">
      <CopyButton text="https://github.com/acme/app/pull/7" label="Copy link">Copy link</CopyButton>
      <CopyButton text={() => 'git fetch origin pull/7/head'} label="Copy command" />
      <CopyButton text="x" label="Disabled" disabled>Disabled</CopyButton>
      <CopyCommand command="az login --tenant contoso.onmicrosoft.com" />
    </div>
  ),
};

export const Errors: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <PrError error={new Error('GitHub returned 403: rate limit exceeded')} />
      <PrError error="A plain string error" />
      <PrError error={null} />
    </div>
  ),
};

export const RelativeTimes: Story = {
  render: () => {
    const now = Date.now();
    const samples = [30_000, 5 * 60_000, 3 * 3_600_000, 26 * 3_600_000, 9 * 86_400_000, 60 * 86_400_000, 400 * 86_400_000];
    return (
      <div className="flex flex-col gap-1 font-mono text-xs">
        {samples.map((ms) => <span key={ms}>{relativeTime(new Date(now - ms).toISOString(), now)}</span>)}
      </div>
    );
  },
};
