import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChevronRightIcon, TagIcon } from 'lucide-react';
import { SectionLabel } from './section-label';

/** The one label for a group of things. Spacing comes from the caller; typography from here. */

const meta = {
  title: 'Primitives/SectionLabel',
  component: SectionLabel,
  parameters: { layout: 'padded' },
  args: { children: 'Active' },
} satisfies Meta<typeof SectionLabel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithIconAndCount: Story = {
  render: () => (
    <SectionLabel className="px-2 py-1">
      <ChevronRightIcon className="size-3" />
      <TagIcon className="size-3" />
      <span>auth</span>
      <span className="tabular-nums">3</span>
    </SectionLabel>
  ),
};

export const AsHeading: Story = {
  render: () => (
    <SectionLabel asChild>
      <h3 className="mb-2">Revoked (2)</h3>
    </SectionLabel>
  ),
};

export const InContext: Story = {
  render: () => (
    <div className="w-72 rounded-xl border bg-sidebar p-2 text-sidebar-foreground">
      <SectionLabel className="px-2 py-1">Today</SectionLabel>
      <div className="rounded-md px-2 py-1.5 text-sm">Refactor the auth module</div>
      <div className="rounded-md px-2 py-1.5 text-sm">Deploy to staging</div>
      <SectionLabel className="px-2 py-1">Yesterday</SectionLabel>
      <div className="rounded-md px-2 py-1.5 text-sm">Write README</div>
    </div>
  ),
};
