import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { McpServerForm } from './McpServerForm';
import { mcpConfigs } from '../../../../.storybook/mocks/mockSettings';

/** Add or edit one MCP server: local command with env, or remote URL with OAuth or headers. */

const meta = {
  title: 'Settings/McpServerForm',
  component: McpServerForm,
  parameters: { layout: 'padded' },
  args: { names: ['filesystem', 'linear'], pending: false, onSave: fn(async () => {}), onCancel: fn() },
  decorators: [(Story) => <div className="w-[36rem] rounded-xl border bg-card p-3"><Story /></div>],
} satisfies Meta<typeof McpServerForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const New: Story = {};

export const EditLocal: Story = {
  args: { name: 'filesystem', config: mcpConfigs.filesystem },
};

export const EditRemote: Story = {
  args: { name: 'linear', config: mcpConfigs.linear },
};

export const EditRemoteWithHeaders: Story = {
  args: { name: 'internal', config: mcpConfigs.internal },
};

export const Saving: Story = {
  args: { name: 'filesystem', config: mcpConfigs.filesystem, pending: true },
};
