import type { Meta, StoryObj } from '@storybook/react-vite';
import { Braces, ChevronDown, GitBranch, ShieldCheck } from 'lucide-react';
import { Chip, ChipLabel } from './chip';

/**
 * Session setting chips: icon, value, optional chevron. They size to the
 * `composer` container: under 32rem only the icon shows. A container needs an
 * explicit width (inline-size containment makes it shrink to nothing otherwise),
 * so each story sets one.
 */

const meta = {
  title: 'Primitives/Chip',
  component: Chip,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Chip>;

export default meta;
type Story = StoryObj<typeof meta>;

const row = (
  <>
    <Chip aria-label="Checkout: feature/login"><GitBranch /><ChipLabel>feature/login</ChipLabel></Chip>
    <Chip aria-label="Standard permissions"><ShieldCheck className="text-success" /><ChipLabel>Standard<ChevronDown className="size-3 opacity-60" /></ChipLabel></Chip>
    <Chip aria-label="Response format: Issue report"><Braces className="text-highlight" /><ChipLabel>Issue report<ChevronDown className="size-3 opacity-60" /></ChipLabel></Chip>
    <Chip disabled aria-label="Standard permissions"><ShieldCheck /><ChipLabel>Standard</ChipLabel></Chip>
  </>
);

export const Default: Story = {
  args: { 'aria-label': 'Standard permissions', children: <><ShieldCheck className="text-success" /><ChipLabel>Standard<ChevronDown className="size-3 opacity-60" /></ChipLabel></> },
  render: (args) => <div className="@container/composer w-[40rem] max-w-full"><Chip {...args} /></div>,
};

export const Row: Story = {
  render: () => <div className="@container/composer flex w-[40rem] max-w-full flex-wrap gap-1.5">{row}</div>,
};

/** The same row inside a composer narrower than 32rem: icons only. */
export const NarrowComposer: Story = {
  render: () => <div className="@container/composer flex w-80 flex-wrap gap-1.5">{row}</div>,
};
