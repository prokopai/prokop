import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from './collapsible';
import { Button } from './button';
import { ChevronsUpDownIcon } from 'lucide-react';

const meta = {
  title: 'Primitives/Collapsible',
  component: Collapsible,
  parameters: {
    layout: 'centered',
  },
} satisfies Meta<typeof Collapsible>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: function CollapsibleDefault() {
    const [isOpen, setIsOpen] = useState(false);
    return (
      <Collapsible
        open={isOpen}
        onOpenChange={setIsOpen}
        className="w-80 space-y-2"
      >
        <div className="flex items-center justify-between gap-4">
          <h4 className="text-sm font-medium">
            @peduarte starred 3 repositories
          </h4>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="icon-sm">
              <ChevronsUpDownIcon className="size-4" />
              <span className="sr-only">Toggle</span>
            </Button>
          </CollapsibleTrigger>
        </div>
        <div className="rounded-md border px-4 py-2 text-sm font-mono">
          @radix-ui/primitives
        </div>
        <CollapsibleContent className="space-y-2">
          <div className="rounded-md border px-4 py-2 text-sm font-mono">
            @radix-ui/colors
          </div>
          <div className="rounded-md border px-4 py-2 text-sm font-mono">
            @stitches/react
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  },
};

export const AlwaysOpen: Story = {
  render: () => (
    <Collapsible defaultOpen className="w-80 space-y-2">
      <div className="flex items-center justify-between gap-4">
        <h4 className="text-sm font-medium">Expanded Section</h4>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="icon-sm">
            <ChevronsUpDownIcon className="size-4" />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <p className="text-sm text-muted-foreground">
          This content is visible by default because the collapsible starts open.
          Click the toggle button to collapse it.
        </p>
      </CollapsibleContent>
    </Collapsible>
  ),
};
