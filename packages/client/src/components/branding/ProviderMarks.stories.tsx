import type { Meta, StoryObj } from '@storybook/react-vite';
import * as Marks from './ProviderMarks';

/** Every provider mark at the sizes the chrome uses, drawn with `currentColor`. */

const SIZES = ['size-3.5', 'size-4', 'size-5', 'size-6', 'size-8'] as const;

const meta = {
  title: 'Shared/ProviderMarks',
  parameters: { layout: 'centered' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="grid grid-cols-[6rem_repeat(5,auto)] items-center gap-x-6 gap-y-3">
      {Object.entries(Marks).map(([name, Mark]) => (
        <div key={name} className="contents">
          <span className="text-xs text-muted-foreground">{name.replace(/Mark$/, '')}</span>
          {SIZES.map((size) => <Mark key={size} className={size} />)}
        </div>
      ))}
    </div>
  ),
};

export const Muted: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
      {Object.entries(Marks).map(([name, Mark]) => <Mark key={name} className="size-5" />)}
    </div>
  ),
};
