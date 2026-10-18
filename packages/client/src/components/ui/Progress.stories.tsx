import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Progress } from './progress';

const meta = {
  title: 'Primitives/Progress',
  component: Progress,
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    value: { control: { type: 'range', min: 0, max: 100 } },
  },
  args: {
    value: 33,
  },
} satisfies Meta<typeof Progress>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Halfway: Story = {
  args: { value: 50 },
};

export const Complete: Story = {
  args: { value: 100 },
};

export const Zero: Story = {
  args: { value: 0 },
};

export const Animated: Story = {
  render: function ProgressAnimated() {
    const [value, setValue] = useState(0);
    return (
      <div className="w-64 space-y-3">
        <Progress value={value} />
        <div className="flex gap-2">
          <button
            className="rounded bg-muted px-2 py-1 text-xs"
            onClick={() => setValue(Math.max(0, value - 10))}
          >
            -10
          </button>
          <span className="text-sm">{value}%</span>
          <button
            className="rounded bg-muted px-2 py-1 text-xs"
            onClick={() => setValue(Math.min(100, value + 10))}
          >
            +10
          </button>
        </div>
      </div>
    );
  },
};
