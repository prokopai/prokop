import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { PermissionListItem } from './PermissionListItem';
import { createPermissionGrant } from '../../../.storybook/mocks/mockSettings';

/** One saved approval: tool, resource, patterns, scope, dates, revoke. */

const meta = {
  title: 'Settings/PermissionListItem',
  component: PermissionListItem,
  parameters: { layout: 'padded' },
  args: { permission: createPermissionGrant(), onRevoke: fn() },
  decorators: [(Story) => <div className="w-[36rem]"><Story /></div>],
} satisfies Meta<typeof PermissionListItem>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ShellCommand: Story = {};

export const PathPrefix: Story = {
  args: { permission: createPermissionGrant({ toolName: 'write', resource: 'path', action: 'write', matcher: 'prefix', patterns: ['src/', 'docs/'] }) },
};

export const Denied: Story = {
  args: { permission: createPermissionGrant({ toolName: 'read-file', resource: 'file', action: 'read', matcher: 'glob', patterns: ['**/*.env'], allowed: false }) },
};

export const SessionScopedExpiring: Story = {
  args: { permission: createPermissionGrant({ toolName: 'fetch', resource: 'network', action: 'request', scope: 'session', patterns: ['https://api.github.com/'], expiresAt: new Date(Date.now() + 3_600_000).toISOString() }) },
};

export const Revoked: Story = {
  args: { permission: createPermissionGrant({ patterns: ['git push --force'], revokedAt: new Date().toISOString(), revokedBy: 'daniel' }) },
};

export const LongPatterns: Story = {
  args: { permission: createPermissionGrant({ patterns: Array.from({ length: 8 }, (_, i) => `bun run script-${i} --flag value-${i}`) }) },
};
