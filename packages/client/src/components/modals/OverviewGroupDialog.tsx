import { useState, useMemo, useEffect, useCallback } from 'react';
import type { Agent, Workspace } from '@prokopai/sdk';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { FormGrid, SettingsRow } from '@/components/ui/settings-row';
import { ArrowDown, ArrowUp, Bot, Box, Folder, Trash2 } from 'lucide-react';
import type { OverviewGroup } from '@/config/overviewGroupsTypes';
import {
  AGENT_HOME_LABEL,
  getWorkspaceDisplayName,
  isAgentHomeWorkspace,
} from '@/lib/workspaceKind';

interface OverviewGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  serverId: string;
  groups: OverviewGroup[];
  workspaces: Workspace[];
  agents: Agent[];
  preselectedWorkspaceId?: string | null;
  editingGroupId?: string | null;
  actions: {
    createGroup: (serverId: string, name: string, workspaceIds?: string[]) => string | null;
    renameGroup: (groupId: string, name: string) => boolean;
    setGroupWorkspaces: (groupId: string, workspaceIds: string[]) => void;
    deleteGroup: (groupId: string) => void;
  };
  onCreated?: (groupId: string) => void;
}

const NAME_LIMIT = 50;

export function OverviewGroupDialog({
  open,
  onOpenChange,
  mode,
  serverId,
  groups,
  workspaces,
  agents,
  preselectedWorkspaceId,
  editingGroupId,
  actions,
  onCreated,
}: OverviewGroupDialogProps) {
  const editingGroup = useMemo(
    () => groups.find((g) => g.id === editingGroupId) ?? null,
    [groups, editingGroupId],
  );

  const [name, setName] = useState('');
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    setNameError(null);
    if (mode === 'edit' && editingGroup) {
      setName(editingGroup.name);
      setSelectedWorkspaceIds(editingGroup.workspaceIds);
    } else {
      setName('');
      setSelectedWorkspaceIds(
        preselectedWorkspaceId ? [preselectedWorkspaceId] : [],
      );
    }
  }, [open, mode, editingGroup, preselectedWorkspaceId]);

  const validateName = useCallback(
    (value: string): string | null => {
      const trimmed = value.trim();
      if (!trimmed) return 'Name is required';
      const isTaken = groups.some(
        (g) =>
          g.serverId === serverId &&
          g.name.toLowerCase() === trimmed.toLowerCase() &&
          g.id !== editingGroupId,
      );
      if (isTaken) return 'A group with this name already exists';
      return null;
    },
    [groups, serverId, editingGroupId],
  );

  const handleNameChange = (value: string) => {
    const capped = value.slice(0, NAME_LIMIT);
    setName(capped);
    if (nameError) setNameError(null);
  };

  const toggleWorkspace = (workspaceId: string) => {
    setSelectedWorkspaceIds((previousIds) =>
      previousIds.includes(workspaceId)
        ? previousIds.filter((id) => id !== workspaceId)
        : [...previousIds, workspaceId],
    );
  };

  const availableWorkspaceIds = useMemo(
    () => new Set(workspaces.map((workspace) => workspace.id)),
    [workspaces],
  );

  const visibleSelectedWorkspaceIds = useMemo(
    () => selectedWorkspaceIds.filter((id) => availableWorkspaceIds.has(id)),
    [availableWorkspaceIds, selectedWorkspaceIds],
  );

  const moveWorkspace = (workspaceId: string, direction: -1 | 1) => {
    setSelectedWorkspaceIds((previousIds) => {
      const visibleIds = previousIds.filter((id) => availableWorkspaceIds.has(id));
      const currentVisibleIndex = visibleIds.indexOf(workspaceId);
      const targetId = visibleIds[currentVisibleIndex + direction];
      if (currentVisibleIndex === -1 || !targetId) return previousIds;

      const currentIndex = previousIds.indexOf(workspaceId);
      const targetIndex = previousIds.indexOf(targetId);
      const nextIds = [...previousIds];
      [nextIds[currentIndex], nextIds[targetIndex]] = [
        nextIds[targetIndex],
        nextIds[currentIndex],
      ];
      return nextIds;
    });
  };

  const orderedWorkspaces = useMemo(() => {
    const workspaceMap = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
    const selected = visibleSelectedWorkspaceIds
      .map((id) => workspaceMap.get(id))
      .filter((workspace): workspace is Workspace => workspace !== undefined);
    const selectedSet = new Set(selectedWorkspaceIds);
    return [
      ...selected,
      ...workspaces.filter((workspace) => !selectedSet.has(workspace.id)),
    ];
  }, [selectedWorkspaceIds, visibleSelectedWorkspaceIds, workspaces]);

  const handleSave = () => {
    const error = validateName(name);
    if (error) {
      setNameError(error);
      return;
    }

    const ids = selectedWorkspaceIds;

    if (mode === 'create') {
      const newId = actions.createGroup(serverId, name, ids);
      if (newId) {
        onCreated?.(newId);
        onOpenChange(false);
      } else {
        setNameError('Failed to create group');
      }
    } else if (mode === 'edit' && editingGroupId) {
      actions.renameGroup(editingGroupId, name);
      actions.setGroupWorkspaces(editingGroupId, ids);
      onOpenChange(false);
    }
  };

  const handleDelete = () => {
    if (!editingGroupId) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    actions.deleteGroup(editingGroupId);
    onOpenChange(false);
  };

  const title = mode === 'create' ? 'Create group' : 'Manage group';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col overflow-hidden gap-4 max-w-[calc(100vw-1rem)] sm:max-w-md sm:max-h-[85vh]">
        <DialogHeader className="shrink-0">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <FormGrid className="shrink-0">
          <SettingsRow label="Name" htmlFor="overview-group-name" description={nameError ? <span className="text-error">{nameError}</span> : `${name.length}/${NAME_LIMIT}`}>
            <Input
              id="overview-group-name"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              maxLength={NAME_LIMIT}
              placeholder="e.g. Active Projects"
              aria-invalid={!!nameError}
              className="sm:w-56"
            />
          </SettingsRow>
          <SettingsRow label="Shown in Overview" description="Workspaces and agent homes, in this order." />
        </FormGrid>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain dialog-scrollbar">
          {workspaces.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">
              No workspaces or agent homes available on this server.
            </p>
          ) : (
            <div className="flex flex-col">
              {orderedWorkspaces.map((workspace) => {
                const isSelected = selectedWorkspaceIds.includes(workspace.id);
                const selectedIndex = visibleSelectedWorkspaceIds.indexOf(workspace.id);
                const displayName = getWorkspaceDisplayName(workspace, agents);
                return (
                  <div
                    key={workspace.id}
                    className="flex min-h-7 items-center gap-2 rounded-md px-2 py-1 hover:bg-muted"
                  >
                    <Checkbox
                      id={`overview-group-workspace-${workspace.id}`}
                      checked={isSelected}
                      onCheckedChange={() => toggleWorkspace(workspace.id)}
                    />
                    <label
                      htmlFor={`overview-group-workspace-${workspace.id}`}
                      className="flex min-w-0 flex-1 items-center gap-2"
                    >
                      {isAgentHomeWorkspace(workspace) ? (
                        <Bot className="size-4 text-muted-foreground" />
                      ) : workspace.isVirtual ? (
                        <Box className="size-4 text-muted-foreground" />
                      ) : (
                        <Folder className="size-4 text-muted-foreground" />
                      )}
                      <span className="truncate text-sm">{displayName}</span>
                      {isAgentHomeWorkspace(workspace) && (
                        <Badge variant="secondary" className="shrink-0 text-2xs">
                          {AGENT_HOME_LABEL}
                        </Badge>
                      )}
                    </label>
                    {isSelected && (
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => moveWorkspace(workspace.id, -1)}
                          disabled={selectedIndex === 0}
                          aria-label={`Move ${displayName} up`}
                          title="Move up"
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => moveWorkspace(workspace.id, 1)}
                          disabled={selectedIndex === visibleSelectedWorkspaceIds.length - 1}
                          aria-label={`Move ${displayName} down`}
                          title="Move down"
                        >
                          <ArrowDown />
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0">
          {mode === 'edit' && (
            <Button
              variant="destructive"
              onClick={handleDelete}
              className="sm:mr-auto"
            >
              <Trash2 data-icon="inline-start" />
              {confirmDelete ? 'Confirm delete' : 'Delete'}
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!!nameError}>
            {mode === 'create' ? 'Create' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
