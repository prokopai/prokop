import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { FolderIcon, MessageSquareIcon, MoreHorizontalIcon, PinIcon, PlusIcon } from 'lucide-react';
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarSeparator,
} from './sidebar';
import { Button } from './button';

/**
 * List primitives for dock content. Placement and width belong to the dock;
 * these only style headers, groups and rows. Rendered here inside a dock-sized
 * column on the sidebar surface.
 */

function Dock({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[32rem] w-72 flex-col rounded-xl border bg-sidebar text-sidebar-foreground">
      {children}
    </div>
  );
}

interface Args { onSelect: () => void; onAction: () => void }

const meta = {
  title: 'Primitives/Sidebar',
  parameters: { layout: 'centered' },
  args: { onSelect: fn(), onAction: fn() },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<Args>;

export const Default: Story = {
  render: ({ onSelect, onAction }) => (
    <Dock>
      <SidebarHeader className="flex-row items-center justify-between">
        <span className="px-1 text-sm font-medium">my-project</span>
        <Button variant="ghost" size="icon-xs" aria-label="New session"><PlusIcon /></Button>
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Today</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton isActive onClick={onSelect}><MessageSquareIcon /><span>Refactor the auth module</span></SidebarMenuButton>
                <SidebarMenuAction showOnHover aria-label="More" onClick={onAction}><MoreHorizontalIcon /></SidebarMenuAction>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={onSelect}><MessageSquareIcon /><span>Fix flaky terminal resize test with a very long title that truncates</span></SidebarMenuButton>
                <SidebarMenuAction showOnHover aria-label="More" onClick={onAction}><MoreHorizontalIcon /></SidebarMenuAction>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton size="sm" onClick={onSelect}><span>Small row</span></SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Pinned</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={onSelect}><PinIcon /><span>Deployment checklist</span></SidebarMenuButton>
                <SidebarMenuSub>
                  <SidebarMenuItem>
                    <SidebarMenuButton size="sm" onClick={onSelect}><FolderIcon /><span>Nested item</span></SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenuSub>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>States</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem><SidebarMenuButton variant="outline" onClick={onSelect}><span>Outline</span></SidebarMenuButton></SidebarMenuItem>
              <SidebarMenuItem><SidebarMenuButton size="lg" onClick={onSelect}><span>Large</span></SidebarMenuButton></SidebarMenuItem>
              <SidebarMenuItem><SidebarMenuButton disabled><span>Disabled</span></SidebarMenuButton></SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Dock>
  ),
};

export const Empty: Story = {
  render: () => (
    <Dock>
      <SidebarHeader><span className="px-1 text-sm font-medium">my-project</span></SidebarHeader>
      <SidebarSeparator />
      <SidebarContent>
        <div className="px-4 py-8 text-center text-xs text-muted-foreground">No sessions yet.</div>
      </SidebarContent>
    </Dock>
  ),
};
