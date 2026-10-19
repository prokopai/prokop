import { useState } from 'react';
import { Bot, Check, Lock } from 'lucide-react';
import type { Preconfig } from '@prokopai/sdk';
import { Chip, ChipLabel } from '@/components/ui/chip';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { PickerSurface } from '@/components/ui/picker-surface';
import { cn } from '@/lib/utils';

export interface AgentChipProps {
  preconfigs: Preconfig[];
  /** Ids of promoted agents; they get the highlight tint. */
  agentIds?: string[];
  selectedId: string | null | undefined;
  /** The workspace belongs to one agent: the chip shows it but nothing can change. */
  locked?: boolean;
  disabled?: boolean;
  /** Display name for a preconfig's pinned model, when the id is known to a catalog. */
  pinnedModelName?: (preconfig: Preconfig) => string | null;
  onSelect: (preconfigId: string) => void;
}

/**
 * The agent chip in the session header: which preconfig answers. The picker is
 * one searchable list; each row carries the agent's one-line description and,
 * when it pins a model, that model, so picking an agent shows what else it
 * changes. A locked chip (agent-home workspaces) stays visible with a lock.
 */
export function AgentChip({
  preconfigs,
  agentIds = [],
  selectedId,
  locked,
  disabled,
  pinnedModelName,
  onSelect,
}: AgentChipProps) {
  const [open, setOpen] = useState(false);
  const selected = preconfigs.find((p) => p.id === selectedId);
  const isAgent = (id: string) => agentIds.includes(id);
  const name = selected?.name ?? 'No agent';
  const title = locked ? `Agent: ${name} (this workspace belongs to it)` : `Agent: ${name}`;
  const tinted = selected ? isAgent(selected.id) : false;

  return (
    <PickerSurface
      open={open}
      onOpenChange={setOpen}
      title="Agent"
      description={name}
      className="w-72"
      trigger={
        <Chip
          disabled={disabled}
          aria-label={title}
          title={title}
          role="combobox"
          aria-expanded={open}
          className={cn('max-w-48', tinted && 'text-highlight')}
        >
          {locked ? <Lock /> : <Bot />}
          <ChipLabel><span className="truncate">{name}</span></ChipLabel>
        </Chip>
      }
    >
      {locked ? (
        <p className="px-3 py-2.5 text-sm text-muted-foreground">
          This workspace belongs to <span className="text-foreground">{name}</span>, so every session here runs as that agent.
        </p>
      ) : (
        <Command loop className="bg-transparent p-0">
          <CommandInput placeholder="Search agents…" autoFocus={typeof window !== 'undefined' && !window.matchMedia('(pointer: coarse)').matches} />
          <CommandList className="max-h-[50vh] p-1">
            <CommandEmpty>No agent found.</CommandEmpty>
            {preconfigs.map((preconfig) => {
              const pinned = pinnedModelName?.(preconfig) ?? preconfig.model;
              const active = preconfig.id === selectedId;
              return (
                <CommandItem
                  key={preconfig.id}
                  value={`${preconfig.name} ${preconfig.id} ${preconfig.description}`}
                  showCheck={false}
                  onSelect={() => { onSelect(preconfig.id); setOpen(false); }}
                  className="items-start py-1.5"
                >
                  <Bot className={cn('mt-0.5 size-4', isAgent(preconfig.id) ? 'text-highlight' : 'text-muted-foreground')} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate">{preconfig.name}</span>
                      {preconfig.isDefault && <span className="shrink-0 text-xs text-muted-foreground">default</span>}
                    </span>
                    {(preconfig.description || pinned) && (
                      <span className="truncate text-xs text-muted-foreground">
                        {[preconfig.description, pinned ? `${pinned}${preconfig.variant ? ` · ${preconfig.variant}` : ''}` : null].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                  <Check className={cn('mt-0.5 size-4 shrink-0', active ? 'opacity-100' : 'opacity-0')} />
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      )}
    </PickerSurface>
  );
}
