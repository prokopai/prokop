import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './button';
import { MailIcon, PlusIcon, LoaderCircleIcon, ArrowRightIcon } from 'lucide-react';

const meta = {
  title: 'Primitives/Button',
  component: Button,
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'outline', 'secondary', 'ghost', 'destructive', 'link'],
    },
    size: {
      control: 'select',
      options: ['default', 'xs', 'sm', 'lg', 'icon', 'icon-xs', 'icon-sm', 'icon-lg'],
    },
    disabled: { control: 'boolean' },
    children: { control: 'text' },
  },
  args: {
    children: 'Button',
    variant: 'default',
    size: 'default',
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Outline: Story = {
  args: { variant: 'outline' },
};

export const Secondary: Story = {
  args: { variant: 'secondary' },
};

export const Ghost: Story = {
  args: { variant: 'ghost' },
};

export const Destructive: Story = {
  args: { variant: 'destructive' },
};

export const Link: Story = {
  args: { variant: 'link' },
};

export const ExtraSmall: Story = {
  args: { size: 'xs' },
};


export const Large: Story = {
  args: { size: 'lg' },
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const WithIcon: Story = {
  args: {
    children: (
      <>
        <MailIcon />
        Login with Email
      </>
    ),
  },
};

export const IconOnly: Story = {
  args: {
    size: 'icon',
    children: <PlusIcon />,
  },
};

export const IconExtraSmall: Story = {
  args: {
    size: 'icon-xs',
    children: <PlusIcon />,
  },
};


export const IconLarge: Story = {
  args: {
    size: 'icon-lg',
    children: <PlusIcon />,
  },
};

export const Loading: Story = {
  args: {
    disabled: true,
    children: (
      <>
        <LoaderCircleIcon className="animate-spin" />
        Loading…
      </>
    ),
  },
};

export const WithIconEnd: Story = {
  args: {
    children: (
      <>
        Continue
        <ArrowRightIcon data-icon="inline-end" />
      </>
    ),
  },
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Button variant="default">Default</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="destructive">Destructive</Button>
      <Button variant="link">Link</Button>
    </div>
  ),
};

export const AllSizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="xs">XS</Button>
      <Button size="default">Default</Button>
      <Button size="lg">LG</Button>
      <Button size="icon-xs"><PlusIcon /></Button>
      <Button size="icon"><PlusIcon /></Button>
      <Button size="icon"><PlusIcon /></Button>
      <Button size="icon-lg"><PlusIcon /></Button>
    </div>
  ),
};
