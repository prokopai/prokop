import type { Meta, StoryObj } from '@storybook/react-vite';
import { CopyIcon, PinIcon, TrashIcon } from 'lucide-react';
import { TitleTooltipLayer } from './TitleTooltipLayer';
import { Button } from '@/components/ui/button';

/**
 * Mounted once in the shell. Every `title` attribute in the app is shown as
 * an app-styled tooltip after the standard delay instead of the native one.
 * Hover the controls below.
 */

const meta = {
  title: 'Shared/TitleTooltipLayer',
  component: TitleTooltipLayer,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof TitleTooltipLayer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <>
      <TitleTooltipLayer />
      <div className="flex flex-col items-center gap-6">
        <div className="flex gap-2">
          <Button variant="ghost" size="icon-sm" title="Copy path"><CopyIcon /></Button>
          <Button variant="ghost" size="icon-sm" title="Pin message"><PinIcon /></Button>
          <Button variant="ghost" size="icon-sm" title="Delete session&#10;This cannot be undone"><TrashIcon /></Button>
        </div>
        <span className="text-xs text-muted-foreground" title="Started 2 minutes ago on this machine">
          2 min ago (hover for the full time)
        </span>
        <div className="w-64 truncate rounded-md border px-2 py-1 text-sm" title="/Users/me/projects/work/team/deeply-nested-repo/packages/client/src/components/shared/TitleTooltipLayer.tsx">
          /Users/me/projects/work/team/deeply-nested-repo/packages/client/src/components/shared/TitleTooltipLayer.tsx
        </div>
      </div>
    </>
  ),
};
