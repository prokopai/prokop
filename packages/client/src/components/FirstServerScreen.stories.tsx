import type { Meta, StoryObj } from '@storybook/react-vite';
import FirstServerScreen from './FirstServerScreen';
import { ServerContext } from '@/contexts/ServerContext';
import { createServerContextValue, withMemoryRouter, STORY_ROUTES, storyServer } from '../../.storybook/harness';

/**
 * First run and "add server": name and address, or a pasted pairing link.
 * Submitting checks the address; in Storybook that check fails and shows the
 * error path.
 */

const meta = {
  title: 'Shell/FirstServerScreen',
  component: FirstServerScreen,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => <ServerContext.Provider value={createServerContextValue({ servers: [] })}><div className="h-screen"><Story /></div></ServerContext.Provider>,
    withMemoryRouter(STORY_ROUTES.home),
  ],
} satisfies Meta<typeof FirstServerScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FirstRun: Story = {};

export const WithError: Story = {
  args: { error: 'The server at http://localhost:8742 did not answer.' },
};

export const AddingAnother: Story = {
  decorators: [(Story) => <ServerContext.Provider value={createServerContextValue({ servers: [storyServer] })}><Story /></ServerContext.Provider>],
};

export const Phone: Story = {
  globals: { viewport: { value: 'phone' } },
};
