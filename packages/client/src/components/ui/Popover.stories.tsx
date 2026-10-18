import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
} from './popover';
import { Button } from './button';
import { Input } from './input';
import { Label } from './label';

const meta = {
  title: 'Primitives/Popover',
  component: Popover,
  parameters: {
    layout: 'centered',
  },
} satisfies Meta<typeof Popover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">Open Popover</Button>
      </PopoverTrigger>
      <PopoverContent>
        <PopoverHeader>
          <PopoverTitle>Dimensions</PopoverTitle>
          <PopoverDescription>Set the dimensions for the layer.</PopoverDescription>
        </PopoverHeader>
        <div className="grid gap-2">
          <div className="grid grid-cols-3 items-center gap-2">
            <Label htmlFor="width">Width</Label>
            <Input id="width" defaultValue="100%" className="col-span-2" />
          </div>
          <div className="grid grid-cols-3 items-center gap-2">
            <Label htmlFor="height">Height</Label>
            <Input id="height" defaultValue="25px" className="col-span-2" />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  ),
};

export const SimpleContent: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger asChild>
        <Button>Click me</Button>
      </PopoverTrigger>
      <PopoverContent>
        <p className="text-sm text-muted-foreground">
          This is a simple popover with just text content.
        </p>
      </PopoverContent>
    </Popover>
  ),
};
