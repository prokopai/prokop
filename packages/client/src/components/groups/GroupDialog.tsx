import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { AgentGroup, ProkopaiClient } from '@prokopai/sdk';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FormGrid, SettingsRow } from '@/components/ui/settings-row';
import { useAddGroupMember, useCreateGroup, useRemoveGroupMember, useUpdateGroup } from '@/hooks/queries/useGroupQueries';
import { useServerDataStore } from '@/stores/serverDataStore';
import { cn } from '@/lib/utils';

export const GROUP_MIN_MEMBERS = 2;
export const GROUP_MAX_MEMBERS = 10;

export interface GroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sdkClient: ProkopaiClient | null;
  workspaceId: string | null;
  /** The group to edit; null creates one. */
  editingGroup: AgentGroup | null;
  onCreated?: (group: AgentGroup) => void;
}

/**
 * Create or edit a group: its name, 2 to 10 members picked from the agents,
 * and the member a message goes to when it names nobody. Editing saves the
 * name and default in one call and each membership change in its own, in
 * the order the server needs (joins before leaves, so the group never dips
 * below two).
 */
export function GroupDialog({ open, onOpenChange, sdkClient, workspaceId, editingGroup, onCreated }: GroupDialogProps) {
  const preconfigs = useServerDataStore((state) => state.preconfigs);
  const create = useCreateGroup(sdkClient);
  const update = useUpdateGroup(sdkClient);
  const addMember = useAddGroupMember(sdkClient);
  const removeMember = useRemoveGroupMember(sdkClient);
  const [name, setName] = useState('');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [defaultId, setDefaultId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(editingGroup?.name ?? '');
    setMemberIds(editingGroup?.members.map((member) => member.agentId) ?? []);
    setDefaultId(editingGroup?.defaultAgentId ?? '');
    setError(null);
  }, [open, editingGroup]);

  // Members the roster knows but the agent list no longer lists keep their row, so they can still be removed.
  const known = new Map(preconfigs.map((preconfig) => [preconfig.id, { id: preconfig.id, name: preconfig.name, description: preconfig.description }]));
  for (const member of editingGroup?.members ?? []) {
    if (!known.has(member.agentId)) known.set(member.agentId, { id: member.agentId, name: member.name, description: '' });
  }
  const candidates = [...known.values()];
  const chosen = memberIds.filter((id) => known.has(id));
  const effectiveDefault = chosen.includes(defaultId) ? defaultId : chosen[0] ?? '';
  const trimmed = name.trim();
  const valid = trimmed.length > 0 && chosen.length >= GROUP_MIN_MEMBERS && chosen.length <= GROUP_MAX_MEMBERS && !!workspaceId;

  const toggle = (id: string, checked: boolean) => {
    setMemberIds((current) => (checked ? (current.includes(id) ? current : [...current, id]) : current.filter((member) => member !== id)));
  };

  async function save(): Promise<void> {
    if (!valid || !workspaceId) return;
    setSaving(true);
    setError(null);
    try {
      if (!editingGroup) {
        const group = await create.mutateAsync({ workspaceId, name: trimmed, memberAgentIds: chosen, defaultAgentId: effectiveDefault });
        onCreated?.(group);
      } else {
        const before = editingGroup.members.map((member) => member.agentId);
        for (const agentId of chosen.filter((id) => !before.includes(id))) await addMember.mutateAsync({ groupId: editingGroup.id, agentId });
        const updates: { name?: string; defaultAgentId?: string } = {};
        if (trimmed !== editingGroup.name) updates.name = trimmed;
        if (effectiveDefault !== editingGroup.defaultAgentId) updates.defaultAgentId = effectiveDefault;
        if (Object.keys(updates).length > 0) await update.mutateAsync({ groupId: editingGroup.id, updates });
        for (const agentId of before.filter((id) => !chosen.includes(id))) await removeMember.mutateAsync({ groupId: editingGroup.id, agentId });
      }
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next); }}>
      <DialogContent className="flex max-w-[calc(100vw-1rem)] flex-col gap-4 overflow-hidden sm:max-h-[85vh] sm:max-w-xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>{editingGroup ? 'Edit group' : 'New group'}</DialogTitle>
        </DialogHeader>
        <FormGrid className="dialog-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <SettingsRow label="Name" htmlFor="group-name">
            <Input id="group-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="API work" maxLength={80} autoFocus />
          </SettingsRow>
          <SettingsRow label="Members" description={`${chosen.length} of ${GROUP_MAX_MEMBERS}; at least ${GROUP_MIN_MEMBERS}. Each answers from its own hidden session, on its own harness.`} stacked>
            <div className="flex flex-col gap-1" role="group" aria-label="Members">
              {candidates.length === 0 && <p className="text-sm text-muted-foreground">No agents defined yet.</p>}
              {candidates.map((candidate) => {
                const checked = chosen.includes(candidate.id);
                const full = !checked && chosen.length >= GROUP_MAX_MEMBERS;
                return (
                  <label key={candidate.id} className={cn('flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60', full && 'cursor-not-allowed opacity-60')}>
                    <Checkbox checked={checked} disabled={full} onCheckedChange={(value) => toggle(candidate.id, value === true)} aria-label={candidate.name} className="mt-0.5" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{candidate.name}</span>
                      {candidate.description && <span className="block truncate text-xs text-muted-foreground">{candidate.description}</span>}
                    </span>
                  </label>
                );
              })}
            </div>
          </SettingsRow>
          <SettingsRow label="Default member" htmlFor="group-default" description="Answers a message that mentions nobody.">
            <Select value={effectiveDefault} onValueChange={setDefaultId} disabled={chosen.length === 0}>
              <SelectTrigger id="group-default" className="w-56">
                <SelectValue placeholder="Pick members first" />
              </SelectTrigger>
              <SelectContent>
                {chosen.map((id) => <SelectItem key={id} value={id}>{known.get(id)?.name ?? id}</SelectItem>)}
              </SelectContent>
            </Select>
          </SettingsRow>
        </FormGrid>
        {error && <p role="alert" className="shrink-0 text-sm text-error">{error}</p>}
        <DialogFooter className="shrink-0">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={() => void save()} disabled={!valid || saving}>
            {saving && <Loader2 className="size-4 animate-spin" data-icon="inline-start" />}
            {editingGroup ? 'Save' : 'Create group'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
