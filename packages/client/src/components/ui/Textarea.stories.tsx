import type { Meta, StoryObj } from '@storybook/react-vite';
import { Textarea } from './textarea';

const meta = {
  title: 'Primitives/Textarea',
  component: Textarea,
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    placeholder: { control: 'text' },
    disabled: { control: 'boolean' },
  },
  args: {
    placeholder: 'Type your message…',
  },
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithValue: Story = {
  args: { defaultValue: 'This is a longer piece of text that spans multiple lines in the textarea.\n\nIt includes a paragraph break.' },
};

export const Disabled: Story = {
  args: { disabled: true, defaultValue: 'Disabled textarea' },
};

export const Invalid: Story = {
  args: { 'aria-invalid': true, defaultValue: 'Invalid value' },
};

export const WithLabel: Story = {
  render: () => (
    <div className="grid w-full max-w-sm gap-1.5">
      <label htmlFor="bio" className="text-sm font-medium">Bio</label>
      <Textarea id="bio" placeholder="Tell us about yourself…" />
    </div>
  ),
};
