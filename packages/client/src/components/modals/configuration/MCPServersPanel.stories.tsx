import type { Meta, StoryObj } from '@storybook/react-vite';
import { MCPServersPanel } from './MCPServersPanel';
import { createFakeSdkClient } from '../../../../.storybook/harness';
import { createMcpStatus, mcpConfigs } from '../../../../.storybook/mocks/mockSettings';

/** MCP servers for one workspace or globally: status, tools, sign-in, add and edit. */

const meta = {
  title: 'Settings/MCPServersPanel',
  component: MCPServersPanel,
  parameters: { layout: 'padded' },
  args: { sdkClient: createFakeSdkClient(), workspaceId: 'ws-1' },
  decorators: [(Story) => <div className="h-[36rem] w-[40rem] overflow-auto rounded-xl border bg-background"><Story /></div>],
} satisfies Meta<typeof MCPServersPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Workspace: Story = {};

export const Global: Story = {
  args: { workspaceId: null },
};

export const OnlyBuiltins: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { mcp: { getStatus: async () => ({ status: { 'Prokop Browser': createMcpStatus().status['Prokop Browser']!, 'Prokop Visuals': createMcpStatus().status['Prokop Visuals']! } }) } } }) },
};

export const AllFailing: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { mcp: { getStatus: async () => ({ status: { filesystem: { config: mcpConfigs.filesystem, status: { status: 'failed', error: 'spawn npx ENOENT' } }, linear: { config: mcpConfigs.linear, status: { status: 'needs_client_registration', error: 'Dynamic client registration is not supported by this server' } } } }) } } }) },
};

export const Loading: Story = {
  args: { sdkClient: createFakeSdkClient({ latencyMs: 60_000 }) },
};

export const Failed: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { mcp: { getStatus: async () => { throw new Error('MCP registry unavailable'); } } } }) },
};

export const NoWorkspaceYet: Story = {
  args: { workspaceId: undefined },
};

export const Offline: Story = {
  args: { sdkClient: null },
};
