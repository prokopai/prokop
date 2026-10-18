import * as React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ScrollArea, ScrollBar } from './scroll-area';
import { Separator } from './separator';

const meta: Meta<typeof ScrollArea> = {
  title: 'Primitives/ScrollArea',
  component: ScrollArea,
  parameters: {
    layout: 'centered',
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

const tags = Array.from({ length: 50 }).map(
  (_, i, a) => `v1.${a.length - i}`
);

export const Vertical: Story = {
  render: () => (
    <ScrollArea className="h-72 w-48 rounded-md border">
      <div className="p-4">
        <h4 className="mb-4 text-sm font-medium leading-none">Tags</h4>
        {tags.map((tag) => (
          <React.Fragment key={tag}>
            <div className="text-sm">{tag}</div>
            <Separator className="my-2" />
          </React.Fragment>
        ))}
      </div>
    </ScrollArea>
  ),
};

export const Horizontal: Story = {
  render: () => (
    <ScrollArea className="w-96 whitespace-nowrap rounded-md border">
      <div className="flex w-max space-x-4 p-4">
        <div className="h-40 w-60 rounded-md bg-muted" />
        <div className="h-40 w-60 rounded-md bg-muted" />
        <div className="h-40 w-60 rounded-md bg-muted" />
        <div className="h-40 w-60 rounded-md bg-muted" />
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  ),
};

export const BothDirections: Story = {
  render: () => (
    <ScrollArea className="h-72 w-96 rounded-md border">
      <div className="p-4">
        <div className="w-max space-y-2">
          {Array.from({ length: 30 }).map((_, i) => (
            <div key={i} className="flex gap-4">
              {Array.from({ length: 10 }).map((_, j) => (
                <div key={j} className="h-6 w-24 rounded bg-muted" />
              ))}
            </div>
          ))}
        </div>
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  ),
};
