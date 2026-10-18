import type { Meta, StoryObj } from '@storybook/react-vite';
import { ResponseFormatsPanel } from './ResponseFormatsPanel';
import { createFakeSdkClient } from '../../../../.storybook/harness';

/** Structured output formats: list, and a schema editor with a field builder and a raw JSON mode. */

const meta = {
  title: 'Settings/ResponseFormatsPanel',
  component: ResponseFormatsPanel,
  parameters: { layout: 'padded' },
  args: { sdkClient: createFakeSdkClient() },
  decorators: [(Story) => <div className="h-[36rem] w-[40rem] overflow-auto rounded-xl border bg-background"><Story /></div>],
} satisfies Meta<typeof ResponseFormatsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { responseFormats: { list: async () => ({ formats: [] }) } } }) },
};

export const Loading: Story = {
  args: { sdkClient: createFakeSdkClient({ latencyMs: 60_000 }) },
};

export const Failed: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { responseFormats: { list: async () => { throw new Error('Formats directory is missing'); } } } }) },
};

export const Offline: Story = {
  args: { sdkClient: null },
};
