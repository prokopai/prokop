import { useState, type ComponentType } from 'react';
import { Check, ChevronDown, ChevronRight, Cpu } from 'lucide-react';
import { AnthropicMark, OpenAIMark, ProkopMark } from '@/components/branding/BrandMarks';
import { Chip, ChipLabel } from '@/components/ui/chip';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { PickerSurface } from '@/components/ui/picker-surface';
import { cn } from '@/lib/utils';
import type { ModelChoice, ModelGroup, ModelHarness, ModelSelection } from '@/hooks/useSessionModelSelection';

const EFFORT_LABELS: Record<string, string> = {
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'x-high',
  max: 'max',
};

export function effortLabel(key: string): string {
  return EFFORT_LABELS[key] ?? key;
}

const MARKS: Record<ModelHarness, ComponentType<{ className?: string }>> = {
  prokop: ProkopMark,
  'claude-cli': AnthropicMark,
  'codex-cli': OpenAIMark,
};

export interface ModelChipProps {
  groups: ModelGroup[];
  selection: ModelSelection | null;
  /** Shown when the session's model is unknown to every catalog. */
  fallbackName?: string;
  recent?: ModelChoice[];
  /** False once a session is established: only its own harness is listed. */
  canSwitchHarness?: boolean;
  /** Name of the agent whose pinned model the session runs, shown as muted trailing text. */
  pinnedBy?: string | null;
  disabled?: boolean;
  onSelectModel: (choice: ModelChoice) => void;
  onSelectEffort: (effort: string) => void;
}

/**
 * The model chip in the session header: a brand mark and `model · effort`.
 * Its picker is one list: recent picks, then one row per harness that opens
 * into that harness's models (Prokop keeps its provider sub-headings), and
 * an effort row at the bottom for the selected model. Typing flattens all
 * groups and filters across harness, provider and model names.
 */
export function ModelChip({
  groups,
  selection,
  fallbackName,
  recent = [],
  canSwitchHarness = true,
  pinnedBy,
  disabled,
  onSelectModel,
  onSelectEffort,
}: ModelChipProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [openHarness, setOpenHarness] = useState<ModelHarness | null>(null);
  const [effortOpen, setEffortOpen] = useState(false);

  const visibleGroups = canSwitchHarness || !selection ? groups : groups.filter((g) => g.harness === selection.harness);
  const activeHarness = openHarness ?? selection?.harness ?? visibleGroups[0]?.harness ?? null;
  const searching = query.trim().length > 0;
  const Mark = selection ? MARKS[selection.harness] : Cpu;
  const name = selection?.name ?? fallbackName ?? 'Select model';
  const effort = selection?.effort ? effortLabel(selection.effort) : null;
  const label = effort ? `${name} · ${effort}` : name;
  const title = `Model: ${label}${pinnedBy ? ` (via ${pinnedBy})` : ''}`;

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setQuery('');
      setOpenHarness(null);
      setEffortOpen(false);
    }
  };

  const pick = (choice: ModelChoice) => {
    onSelectModel(choice);
    handleOpenChange(false);
  };

  const isSelected = (choice: ModelChoice) => selection?.harness === choice.harness && selection.key === choice.key;

  const modelRow = (choice: ModelChoice, opts: { group?: ModelGroup; trailing?: string; indent?: boolean } = {}) => (
    <CommandItem
      key={`${choice.harness}:${choice.key}`}
      value={`${opts.group?.label ?? ''} ${choice.providerName ?? ''} ${choice.name} ${choice.modelId}`}
      keywords={[choice.harness, choice.providerName ?? '']}
      showCheck={false}
      onSelect={() => pick(choice)}
      className={cn(opts.indent && 'pl-7')}
    >
      <span className="min-w-0 flex-1 truncate">{choice.name}</span>
      {opts.trailing && <span className="shrink-0 text-xs text-muted-foreground">{opts.trailing}</span>}
      <Check className={cn('size-4 shrink-0', isSelected(choice) ? 'opacity-100' : 'opacity-0')} />
    </CommandItem>
  );

  const groupRows = (group: ModelGroup) => {
    if (group.harness !== 'prokop') return group.models.map((m) => modelRow(m, { group, indent: true }));
    // Prokop lists several providers; keep their sub-headings inside the group.
    const byProvider = new Map<string, ModelChoice[]>();
    for (const m of group.models) {
      const list = byProvider.get(m.providerName ?? '') ?? [];
      list.push(m);
      byProvider.set(m.providerName ?? '', list);
    }
    return [...byProvider.entries()].map(([providerName, list]) => (
      <div key={providerName}>
        <div className="px-7 pt-1.5 pb-0.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground">{providerName}</div>
        {list.map((m) => modelRow(m, { group, indent: true }))}
      </div>
    ));
  };

  const harnessRow = (group: ModelGroup) => {
    const HarnessMark = MARKS[group.harness];
    const isOpen = activeHarness === group.harness;
    const current = selection?.harness === group.harness ? selection.name : undefined;
    return (
      <div key={group.harness}>
        <CommandItem
          value={`harness ${group.label}`}
          showCheck={false}
          onSelect={() => setOpenHarness(isOpen ? (selection?.harness === group.harness ? null : group.harness) : group.harness)}
          aria-expanded={isOpen}
          className={cn('font-medium', isOpen && 'bg-foreground/5')}
        >
          <HarnessMark className="size-3.5" />
          <span className="min-w-0 flex-1 truncate">{group.label}</span>
          {!isOpen && current && <span className="shrink-0 truncate text-xs font-normal text-muted-foreground">{current}</span>}
          {isOpen ? <ChevronDown className="size-3.5 shrink-0 opacity-50" /> : <ChevronRight className="size-3.5 shrink-0 opacity-50" />}
        </CommandItem>
        {isOpen && groupRows(group)}
      </div>
    );
  };

  const efforts = selection?.efforts ?? [];

  return (
    <PickerSurface
      open={open}
      onOpenChange={handleOpenChange}
      title="Model"
      description={label}
      trigger={
        <Chip disabled={disabled} aria-label={title} title={title} role="combobox" aria-expanded={open} className="max-w-56">
          <Mark />
          <ChipLabel>
            <span className="truncate">{label}</span>
            {pinnedBy && <span className="truncate text-muted-foreground/70">via {pinnedBy}</span>}
          </ChipLabel>
        </Chip>
      }
    >
      <Command loop className="bg-transparent p-0">
        <CommandInput placeholder="Search models…" value={query} onValueChange={setQuery} autoFocus={typeof window !== 'undefined' && !window.matchMedia('(pointer: coarse)').matches} />
        <CommandList className="max-h-[50vh] p-1">
          <CommandEmpty>No model found.</CommandEmpty>
          {searching ? (
            visibleGroups.map((group) => (
              <CommandGroup key={group.harness} heading={group.label}>
                {group.models.map((m) => modelRow(m, { group, trailing: m.providerName }))}
              </CommandGroup>
            ))
          ) : (
            <>
              {recent.length > 0 && visibleGroups.length > 1 && (
                <CommandGroup heading="Recent">
                  {recent.map((m) => modelRow(m, { trailing: groups.find((g) => g.harness === m.harness)?.label }))}
                </CommandGroup>
              )}
              {visibleGroups.map(harnessRow)}
            </>
          )}
        </CommandList>
      </Command>
      {efforts.length > 0 && selection && (
        <div className="border-t border-border/50 p-1" role="group" aria-label="Effort">
          <button
            type="button"
            onClick={() => setEffortOpen((v) => !v)}
            aria-expanded={effortOpen}
            className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <span className="font-medium">Effort</span>
            <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">{effort ?? 'default'}</span>
            {effortOpen ? <ChevronDown className="size-3.5 shrink-0 opacity-50" /> : <ChevronRight className="size-3.5 shrink-0 opacity-50" />}
          </button>
          {effortOpen && (
            <div role="radiogroup" aria-label="Effort levels" className="pt-0.5">
              {efforts.map((key) => {
                const active = selection.effort === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => { onSelectEffort(key); handleOpenChange(false); }}
                    className="flex h-8 w-full items-center gap-2 rounded-md px-2 pl-7 text-sm outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
                  >
                    <span className="min-w-0 flex-1 truncate text-left">{effortLabel(key)}</span>
                    {selection.defaultEffort === key && <span className="shrink-0 text-xs text-muted-foreground">default</span>}
                    <Check className={cn('size-4 shrink-0', active ? 'opacity-100' : 'opacity-0')} />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </PickerSurface>
  );
}
