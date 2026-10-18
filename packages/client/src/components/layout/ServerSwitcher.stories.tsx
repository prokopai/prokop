import type { Meta, StoryObj } from '@storybook/react-vite';
import { ServerSwitcher } from './ServerSwitcher';
import { withAppContexts, withMemoryRouter, STORY_ROUTES, storyServer } from '../../../.storybook/harness';
import { withConnectionStore } from '../../../.storybook/mocks/storeDecorators';

/** Switch between saved machines, rename one, add one, or go back to the server list. */

const servers = [
  storyServer,
  { ...storyServer, id: 'laptop', name: 'Laptop', url: 'https://laptop.tail1234.ts.net' },
  { ...storyServer, id: 'office', name: 'Office desktop with a long name that truncates', url: 'http://10.0.0.12:8742' },
];

const meta = {
  title: 'Shell/ServerSwitcher',
  component: ServerSwitcher,
  parameters: { layout: 'centered' },
  decorators: [withMemoryRouter(STORY_ROUTES.workspace), withAppContexts({ server: { servers } }), withConnectionStore({ connected: true })],
} satisfies Meta<typeof ServerSwitcher>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Compact: Story = {
  args: { compact: true },
};

export const Disconnected: Story = {
  decorators: [withConnectionStore({ connected: false })],
};

export const SingleServer: Story = {
  decorators: [withAppContexts({ server: { servers: [storyServer] } })],
};
