import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Cpu } from 'lucide-react';
import { PickerSurface } from './picker-surface';
import { Chip, ChipLabel } from './chip';

/** A popover on desktop and a bottom sheet on phones, same body in both. */

function Demo() {
  const [open, setOpen] = useState(false);
  return (
    <div className="@container/chips w-[40rem] max-w-full">
      <PickerSurface
        open={open}
        onOpenChange={setOpen}
        title="Model"
        description="Sonnet 4.5 · medium"
        trigger={<Chip aria-label="Model: Sonnet 4.5"><Cpu /><ChipLabel>Sonnet 4.5 · medium</ChipLabel></Chip>}
      >
        <ul className="p-1 text-sm">
          {['Sonnet 4.5', 'Opus 4.1', 'Haiku 4.5'].map((name) => (
            <li key={name} className="rounded-md px-2 py-1.5 hover:bg-accent">{name}</li>
          ))}
        </ul>
      </PickerSurface>
    </div>
  );
}

const meta = {
  title: 'Primitives/PickerSurface',
  component: PickerSurface,
  parameters: { layout: 'centered' },
} as Meta<typeof PickerSurface>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = { render: () => <Demo /> };

export const Phone: Story = {
  render: () => <Demo />,
  globals: { viewport: { value: 'phone' } },
};
