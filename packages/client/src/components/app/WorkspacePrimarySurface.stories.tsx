import type { Meta, StoryObj } from '@storybook/react-vite';
import { WorkspacePrimarySurface } from './WorkspacePrimarySurface';

/** The center card: a header row and the content below it. */

const meta = {
  title: 'Workspace/WorkspacePrimarySurface',
  component: WorkspacePrimarySurface,
  parameters: { layout: 'fullscreen' },
  args: {
    header: <div className="flex h-10 items-center px-3 text-sm font-medium">Refactor the auth module</div>,
    children: <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">transcript and composer</div>,
  },
  decorators: [(Story) => <div className="flex h-screen flex-col bg-background p-2"><Story /></div>],
} satisfies Meta<typeof WorkspacePrimarySurface>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NoHeader: Story = {
  args: { header: null },
};
