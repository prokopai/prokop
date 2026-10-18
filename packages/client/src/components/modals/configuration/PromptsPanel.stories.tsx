import type { Meta, StoryObj } from '@storybook/react-vite';
import { PromptsPanel } from './PromptsPanel';
import { createFakeSdkClient } from '../../../../.storybook/harness';
import { createPromptList } from '../../../../.storybook/mocks/mockSettings';

/** Saved prompt snippets (`/name` in the composer): list, edit, create, delete. */

const meta = {
  title: 'Settings/PromptsPanel',
  component: PromptsPanel,
  parameters: { layout: 'padded' },
  args: { sdkClient: createFakeSdkClient() },
  decorators: [(Story) => <div className="h-[32rem] w-[36rem] overflow-auto rounded-xl border bg-background"><Story /></div>],
} satisfies Meta<typeof PromptsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Many: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { config: { prompts: { list: async () => ({ prompts: Array.from({ length: 25 }, (_, i) => ({ name: `prompt-${i}`, description: `Prompt number ${i}`, content: `Content ${i}` })) }) } } } }) },
};

export const Empty: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { config: { prompts: { list: async () => ({ prompts: [] }) } } } }) },
};

export const SaveFails: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { config: { prompts: { list: async () => ({ prompts: createPromptList() }), create: async () => { throw new Error('A prompt with that name exists'); }, update: async () => { throw new Error('Disk is read-only'); } } } } }) },
};

export const Loading: Story = {
  args: { sdkClient: createFakeSdkClient({ latencyMs: 60_000 }) },
};

export const Offline: Story = {
  args: { sdkClient: null },
};
