import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import type { ResponseFormat } from '@prokopai/sdk';
import { ResponseFormatSelector } from './ResponseFormatSelector';

/** Picks a structured output format for the next message, or plain text. */

const formats: ResponseFormat[] = [
  { id: 'fmt-review', name: 'Code review', description: 'Summary, severity and findings', schema: { type: 'object' }, createdAt: 1, updatedAt: 1 },
  { id: 'fmt-plan', name: 'Plan', description: 'Phases with tasks', schema: { type: 'object' }, createdAt: 1, updatedAt: 1 },
  { id: 'fmt-answer', name: 'Short answer', schema: { type: 'object' }, createdAt: 1, updatedAt: 1 },
];

const meta = {
  title: 'Chat/ResponseFormatSelector',
  component: ResponseFormatSelector,
  parameters: { layout: 'centered' },
  args: { formats, onSelect: fn() },
  // The chip folds to its icon by the width of the composer container (ui/chip.tsx).
  decorators: [(Story) => <div className="@container/composer w-[40rem] max-w-full"><Story /></div>],
} satisfies Meta<typeof ResponseFormatSelector>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PlainText: Story = {};

export const FormatSelected: Story = {
  args: { selectedId: 'fmt-review' },
};

export const NoFormats: Story = {
  args: { formats: [] },
};

export const Disabled: Story = {
  args: { selectedId: 'fmt-plan', disabled: true },
};
