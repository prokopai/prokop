import type { Meta, StoryObj } from '@storybook/react-vite';
import { Alert, AlertTitle, AlertDescription, AlertAction } from './alert';
import { Button } from './button';
import { TerminalIcon, AlertCircleIcon } from 'lucide-react';

const meta = {
  title: 'Primitives/Alert',
  component: Alert,
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'error'],
    },
  },
  args: {
    variant: 'default',
  },
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Alert>
      <TerminalIcon />
      <AlertTitle>Heads up!</AlertTitle>
      <AlertDescription>
        You can add components to your app using the CLI.
      </AlertDescription>
    </Alert>
  ),
};

export const Destructive: Story = {
  render: () => (
    <Alert variant="error">
      <AlertCircleIcon />
      <AlertTitle>Error</AlertTitle>
      <AlertDescription>
        Your session has expired. Please log in again.
      </AlertDescription>
    </Alert>
  ),
};

export const WithAction: Story = {
  render: () => (
    <Alert>
      <TerminalIcon />
      <AlertTitle>Update available</AlertTitle>
      <AlertDescription>
        A new version is available for download.
      </AlertDescription>
      <AlertAction>
        <Button size="xs">Update</Button>
      </AlertAction>
    </Alert>
  ),
};

export const Simple: Story = {
  render: () => (
    <Alert>
      <AlertDescription>
        This is a simple alert with no title.
      </AlertDescription>
    </Alert>
  ),
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex w-full max-w-lg flex-col gap-4">
      <Alert>
        <TerminalIcon />
        <AlertTitle>Default Alert</AlertTitle>
        <AlertDescription>This is a default informational alert.</AlertDescription>
      </Alert>
      <Alert variant="error">
        <AlertCircleIcon />
        <AlertTitle>Destructive Alert</AlertTitle>
        <AlertDescription>Something went wrong. Please try again.</AlertDescription>
      </Alert>
    </div>
  ),
};
