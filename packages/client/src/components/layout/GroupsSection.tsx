import { useState } from 'react';
import { ChevronRight, MoreHorizontal, Pencil, Plus, Trash2, Users } from 'lucide-react';
import type { AgentGroup } from '@prokopai/sdk';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';

export interface GroupsSectionProps {
  groups: AgentGroup[];
  /** False while the list loads, so an empty list is not shown as "no groups". */
  loaded?: boolean;
  /** Groups whose tab is active in the center. */
  activeGroupIds?: ReadonlySet<string>;
  onOpenGroup: (group: AgentGroup) => void;
  onCreateGroup: () => void;
  onEditGroup: (group: AgentGroup) => void;
  onDeleteGroup: (group: AgentGroup) => void;
}

/**
 * The workspace's group chats in the sidebar, under the sessions: one row
 * per group with its member names, a plus in the header to make one, a menu
 * per row to edit or delete it.
 */
export function GroupsSection({ groups, loaded = true, activeGroupIds, onOpenGroup, onCreateGroup, onEditGroup, onDeleteGroup }: GroupsSectionProps) {
  const [pendingDelete, setPendingDelete] = useState<AgentGroup | null>(null);

  return (
    <>
      <Collapsible defaultOpen className="group/collapsible">
        <SidebarGroup>
          <SidebarGroupLabel asChild>
            <CollapsibleTrigger asChild>
              <div className="group/head flex w-full items-center gap-1.5 py-0.5">
                <ChevronRight className="size-3 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                <span>Groups</span>
                <span className="text-2xs tabular-nums text-muted-foreground/70" aria-label="Groups">{loaded ? groups.length : '…'}</span>
                <span className="flex-1" />
                <button
                  type="button"
                  onClick={(event) => { event.stopPropagation(); onCreateGroup(); }}
                  className="flex size-5 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-hover/head:opacity-100 group-focus-within/head:opacity-100 pointer-coarse:opacity-100"
                  title="New group"
                  aria-label="New group"
                >
                  <Plus className="size-3.5" />
                </button>
              </div>
            </CollapsibleTrigger>
          </SidebarGroupLabel>
          <CollapsibleContent>
            <SidebarGroupContent>
              <SidebarMenu>
                {loaded && groups.length === 0 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">
                    No groups. One chat with several of your agents: <button type="button" className="underline hover:text-foreground" onClick={onCreateGroup}>make one</button>.
                  </div>
                )}
                {groups.map((group) => (
                  <SidebarMenuItem key={group.id}>
                    <div className="group/row flex w-full items-center rounded-md transition-colors hover:bg-sidebar-accent">
                      <SidebarMenuButton
                        isActive={activeGroupIds?.has(group.id) ?? false}
                        onClick={() => onOpenGroup(group)}
                        className="h-auto min-w-0 flex-1 py-1.5"
                        title={group.members.map((member) => member.name).join(', ')}
                      >
                        <Users className="size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{group.name}</div>
                          <div className="truncate text-xs text-muted-foreground">{group.members.map((member) => member.name).join(', ')}</div>
                        </div>
                      </SidebarMenuButton>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="mr-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-sidebar-accent-foreground/10 group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100"
                            aria-label={`Actions for ${group.name}`}
                          >
                            <MoreHorizontal className="size-3.5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-40">
                          <DropdownMenuItem onClick={() => onEditGroup(group)}>
                            <Pencil className="size-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onClick={() => setPendingDelete(group)}>
                            <Trash2 className="size-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </CollapsibleContent>
        </SidebarGroup>
      </Collapsible>
      <ConfirmationDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        title="Delete this group?"
        description={pendingDelete ? `"${pendingDelete.name}" and its ${pendingDelete.members.length} member sessions go away. Running members are stopped.` : ''}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => { if (pendingDelete) onDeleteGroup(pendingDelete); setPendingDelete(null); }}
      />
    </>
  );
}
