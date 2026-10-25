import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { AddRepoControl } from './AddRepoControl';
import { createWorkspace } from '../../../.storybook/mocks';

/** The "open together" picker next to the workspace switcher. */
const workspaces = [
  createWorkspace({ id: 'ws-jean2', name: 'jean2', path: '/home/user/jean2' }),
  createWorkspace({ id: 'ws-db-web', name: 'db-web', path: '/home/user/db-web' }),
  createWorkspace({ id: 'ws-site', name: 'prokop-website', path: '/home/user/prokop-website' }),
];

const meta = {
  title: 'Layout/AddRepoControl',
  component: AddRepoControl,
  parameters: { layout: 'centered' },
  args: { workspaces, agents: [], activeWorkspace: workspaces[0]!, onConfirm: fn() },
} satisfies Meta<typeof AddRepoControl>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

/** With one workspace there is nobody to open together with: nothing renders. */
export const OnlyWorkspace: Story = { args: { workspaces: [workspaces[0]!] } };
