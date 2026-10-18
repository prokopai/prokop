import type { Meta, StoryObj } from '@storybook/react-vite';
import ServerShell from './ServerShell';
import { ServerContext } from '@/contexts/ServerContext';
import { createServerContextValue, withMemoryRouter, STORY_ROUTES, storyServer } from '../../../.storybook/harness';

/**
 * The real shell for one saved machine. It opens a live connection to the
 * server in the route; Storybook has none, so this shows the startup frame
 * and what happens when the machine cannot be reached. Everything inside a
 * connected shell has its own stories under Screens and Workspace.
 */

const meta = {
  title: 'Screens/ServerShell',
  component: ServerShell,
  parameters: {
    layout: 'fullscreen',
    smoke: 'skip: opens a WebSocket to the route server; happy-dom has no socket to fail with',
  },
  decorators: [
    (Story) => <ServerContext.Provider value={createServerContextValue({ servers: [storyServer] })}><div className="h-screen"><Story /></div></ServerContext.Provider>,
    withMemoryRouter(STORY_ROUTES.workspace),
  ],
} satisfies Meta<typeof ServerShell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unreachable: Story = {};

export const UnknownServer: Story = {
  decorators: [withMemoryRouter('/server/missing-server/workspace')],
};

export const Phone: Story = {
  globals: { viewport: { value: 'phone' } },
};
