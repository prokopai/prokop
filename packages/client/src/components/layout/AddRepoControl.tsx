import { useState } from 'react';
import { Bot, Box, Check, Folder, Layers } from 'lucide-react';
import type { Agent, Workspace } from '@prokopai/sdk';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { getSelectableWorkspaces, getWorkspaceDisplayName, isAgentHomeWorkspace } from '@/lib/workspaceKind';
import { sortWorkspaces } from '@/lib/workspaceOrder';
import { useUIStore } from '@/stores/uiStore';
import { cn } from '@/lib/utils';

export interface AddRepoControlProps {
  workspaces: Workspace[];
  agents: Agent[];
  activeWorkspace: Workspace | null;
  /** The picked workspace ids, without the active one. */
  onConfirm: (workspaceIds: string[]) => void;
  disabled?: boolean;
}

/**
 * "Add a repo": next to the workspace switcher, a picker of the other
 * workspaces. Pick one or more and confirm; the caller opens the Overview
 * group that holds this workspace together with them.
 */
export function AddRepoControl({ workspaces, agents, activeWorkspace, onConfirm, disabled }: AddRepoControlProps) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const order = useUIStore((state) => state.workspaceOrder);
  const others = sortWorkspaces(getSelectableWorkspaces(workspaces, agents), agents, order)
    .filter((workspace) => workspace.id !== activeWorkspace?.id);

  const toggle = (id: string) => setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  const confirm = () => {
    if (picked.length === 0) return;
    const ids = picked;
    setOpen(false);
    setPicked([]);
    onConfirm(ids);
  };

  if (!activeWorkspace || others.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setPicked([]); }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label="Open together with another workspace" title="Open together with another workspace" disabled={disabled}>
          <Layers />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Open together with…" />
          <CommandList className="max-h-[50vh] overflow-y-auto">
            <CommandEmpty>No workspace found.</CommandEmpty>
            <CommandGroup heading={`With ${getWorkspaceDisplayName(activeWorkspace, agents)}`}>
              {others.map((workspace) => {
                const name = getWorkspaceDisplayName(workspace, agents);
                const selected = picked.includes(workspace.id);
                const Icon = isAgentHomeWorkspace(workspace) ? Bot : workspace.isVirtual ? Box : Folder;
                return (
                  <CommandItem key={workspace.id} value={`${name} ${workspace.id}`} showCheck={false} onSelect={() => toggle(workspace.id)} aria-selected={selected}>
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                    <Check className={cn('size-4 shrink-0', selected ? 'opacity-100' : 'opacity-0')} aria-hidden />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
        <div className="flex items-center justify-between gap-2 border-t px-2 py-1.5">
          <span className="truncate text-xs text-muted-foreground">{picked.length === 0 ? 'Pick one or more' : `${picked.length + 1} workspaces in one Overview group`}</span>
          <Button size="xs" onClick={confirm} disabled={picked.length === 0}>Open together</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
