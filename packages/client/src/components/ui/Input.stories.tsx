import type { Meta, StoryObj } from '@storybook/react-vite';
import { Input } from './input';

const meta = {
  title: 'Primitives/Input',
  component: Input,
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    type: {
      control: 'select',
      options: ['text', 'email', 'password', 'number', 'search', 'url'],
    },
    placeholder: { control: 'text' },
    disabled: { control: 'boolean' },
  },
  args: {
    placeholder: 'Type something…',
  },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithValue: Story = {
  args: { defaultValue: 'Hello world' },
};

export const Password: Story = {
  args: { type: 'password', placeholder: 'Enter password' },
};

export const Search: Story = {
  args: { type: 'search', placeholder: 'Search…' },
};

export const Disabled: Story = {
  args: { disabled: true, defaultValue: 'Disabled input' },
};

export const Invalid: Story = {
  args: { 'aria-invalid': true, defaultValue: 'Invalid value' },
};

export const WithLabel: Story = {
  render: () => (
    <div className="grid w-full max-w-sm gap-1.5">
      <label htmlFor="email" className="text-sm font-medium">Email</label>
      <Input id="email" type="email" placeholder="you@example.com" />
    </div>
  ),
};

export const FormExample: Story = {
  render: () => (
    <div className="grid w-full max-w-sm gap-3">
      <div className="grid gap-1.5">
        <label htmlFor="name" className="text-sm font-medium">Name</label>
        <Input id="name" placeholder="John Doe" />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="email-input" className="text-sm font-medium">Email</label>
        <Input id="email-input" type="email" placeholder="john@example.com" />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="url-input" className="text-sm font-medium">Website</label>
        <Input id="url-input" type="url" placeholder="https://example.com" />
      </div>
    </div>
  ),
};
