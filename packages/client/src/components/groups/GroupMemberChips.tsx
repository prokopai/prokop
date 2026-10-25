import { useLayoutEffect, useRef, useState } from 'react';
import type { AgentGroupMember } from '@prokopai/sdk';
import type { GroupMemberStatus } from '@/hooks/useGroupMemberStatuses';
import { Chip, ChipLabel } from '@/components/ui/chip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { GroupMemberChip, GroupMemberMenuItems, GroupMemberStatusGlyph, groupMemberStatusWord, type GroupMemberActions } from './GroupMemberChip';

export interface GroupMemberChipEntry extends GroupMemberActions {
  member: AgentGroupMember;
  status: GroupMemberStatus;
  isDefault: boolean;
  colorClass?: string;
}

/** The gap between chips, `gap-1.5`. */
const GAP = 6;
const RANK: Record<GroupMemberStatus, number> = { 'needs-you': 0, working: 1, idle: 2 };

/** Members that need you first, then the working ones, then the idle ones; ties keep the roster order. */
export function orderMembersByAttention<T extends { status: GroupMemberStatus }>(entries: readonly T[]): T[] {
  return entries.map((entry, index) => ({ entry, index }))
    .sort((left, right) => RANK[left.entry.status] - RANK[right.entry.status] || left.index - right.index)
    .map(({ entry }) => entry);
}

/** How many leading chips fit next to an overflow chip for the rest; every chip fits when nothing has been measured. */
export function visibleChipCount(widths: readonly number[], overflowWidth: number, available: number): number {
  if (available <= 0 || widths.every((width) => width === 0)) return widths.length;
  for (let count = widths.length; count >= 0; count -= 1) {
    const chips = widths.slice(0, count).reduce((sum, width) => sum + width, 0) + Math.max(0, count - 1) * GAP;
    const overflow = count < widths.length ? (count > 0 ? GAP : 0) + overflowWidth : 0;
    if (chips + overflow <= available) return count;
  }
  return 0;
}

/**
 * The members in the group header on one row that never scrolls: the ones
 * that fit, most urgent first, then one "+N" chip whose menu holds the rest
 * with their status and the same actions. Widths come from a hidden copy of
 * the row, so the count follows the names and the pane.
 */
export function GroupMemberChips({ entries }: { entries: readonly GroupMemberChipEntry[] }) {
  const ordered = orderMembersByAttention(entries);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const [measured, setMeasured] = useState<{ widths: number[]; overflow: number; available: number }>({ widths: [], overflow: 0, available: 0 });
  const key = ordered.map((entry) => `${entry.member.agentId}:${entry.member.name}:${entry.isDefault ? 1 : 0}:${entry.status}`).join('\u0000');

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measurer = measureRef.current;
    if (!container || !measurer) return;
    const read = () => {
      const chips = Array.from(measurer.querySelectorAll<HTMLElement>('[data-measure="chip"]')).map((chip) => chip.offsetWidth);
      const overflow = measurer.querySelector<HTMLElement>('[data-measure="overflow"]')?.offsetWidth ?? 0;
      const available = container.clientWidth;
      setMeasured((current) => (current.available === available && current.overflow === overflow
        && current.widths.length === chips.length && current.widths.every((width, index) => width === chips[index])
        ? current : { widths: chips, overflow, available }));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(read);
    observer.observe(container);
    return () => observer.disconnect();
  }, [key]);

  const count = measured.widths.length === ordered.length ? visibleChipCount(measured.widths, measured.overflow, measured.available) : ordered.length;
  const shown = ordered.slice(0, count);
  const folded = ordered.slice(count);

  return (
    <div ref={containerRef} className="relative flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
      {shown.map(({ member, status, isDefault, colorClass, ...actions }) => (
        <GroupMemberChip key={member.agentId} name={member.name} status={status} isDefault={isDefault} colorClass={colorClass} {...actions} />
      ))}
      {folded.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Chip aria-label={`${folded.length} more members`} title={folded.map((entry) => entry.member.name).join(', ')} className="px-2 @max-lg/chips:px-2">
              {folded.some((entry) => entry.status === 'needs-you') && <span aria-hidden className="size-2 rounded-full bg-warning" />}
              <span className="font-medium">+{folded.length}</span>
            </Chip>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-52">
            {folded.map(({ member, status, isDefault, colorClass, ...actions }) => (
              <DropdownMenuSub key={member.agentId}>
                <DropdownMenuSubTrigger aria-label={`${member.name}: ${groupMemberStatusWord(status)}`}>
                  <GroupMemberStatusGlyph status={status} />
                  {/* The name takes the room; the status sits by the chevron, which has the row's ml-auto. */}
                  <span className={cn('min-w-0 flex-1 truncate font-medium', colorClass)}>{member.name}</span>
                  <span className="pl-3 text-xs text-muted-foreground">{groupMemberStatusWord(status)}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent className="min-w-52">
                    <GroupMemberMenuItems status={status} isDefault={isDefault} {...actions} />
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {/* The measuring copy: every chip and the widest overflow chip, out of sight and out of the accessibility tree. */}
      <div ref={measureRef} aria-hidden className="pointer-events-none invisible absolute left-0 top-0 flex items-center gap-1.5 whitespace-nowrap" inert>
        {ordered.map(({ member, status, isDefault, colorClass }) => (
          <span key={member.agentId} data-measure="chip" className="inline-flex">
            <Chip tabIndex={-1} className="@max-lg/chips:px-2.5">
              <GroupMemberStatusGlyph status={status} />
              <span className={cn('font-medium', colorClass)}>{member.name}</span>
              {isDefault && <span className="size-3" />}
            </Chip>
          </span>
        ))}
        <span data-measure="overflow" className="inline-flex">
          <Chip tabIndex={-1} className="px-2"><span aria-hidden className="size-2 rounded-full" /><ChipLabel className="inline-flex">+{Math.max(ordered.length, 10)}</ChipLabel></Chip>
        </span>
      </div>
    </div>
  );
}
