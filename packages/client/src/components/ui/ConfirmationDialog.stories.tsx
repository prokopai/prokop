import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { ConfirmationDialog } from './confirmation-dialog';
import { Button } from './button';

const meta = {
  title: 'Primitives/ConfirmationDialog',
  component: ConfirmationDialog,
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'destructive'],
    },
  },
  args: {
    open: false,
    onOpenChange: () => {},
    title: 'Are you sure?',
    description: 'This action cannot be undone.',
    onConfirm: () => {},
  },
} satisfies Meta<typeof ConfirmationDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: function ConfirmationDefault() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>Confirm Action</Button>
        <ConfirmationDialog
          open={open}
          onOpenChange={setOpen}
          title="Are you sure?"
          description="This action cannot be undone. This will permanently delete your account and remove your data from our servers."
          onConfirm={() => { setOpen(false); }}
        />
      </>
    );
  },
};

export const Destructive: Story = {
  render: function ConfirmationDestructive() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button variant="destructive" onClick={() => setOpen(true)}>Delete Account</Button>
        <ConfirmationDialog
          open={open}
          onOpenChange={setOpen}
          title="Delete Account"
          description="This will permanently delete your account and all associated data. This action cannot be undone."
          confirmLabel="Delete"
          variant="destructive"
          onConfirm={() => { setOpen(false); }}
        />
      </>
    );
  },
};

export const CustomLabels: Story = {
  render: function ConfirmationCustomLabels() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>Publish</Button>
        <ConfirmationDialog
          open={open}
          onOpenChange={setOpen}
          title="Publish Changes"
          description="Your changes will be visible to all users. Would you like to proceed?"
          confirmLabel="Publish"
          cancelLabel="Go Back"
          onConfirm={() => { setOpen(false); }}
        />
      </>
    );
  },
};
