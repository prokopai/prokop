import { Loader2, MessageSquare, Square, Star, UserMinus } from 'lucide-react';
import type { GroupMemberStatus } from '@/hooks/useGroupMemberStatuses';
import { Chip } from '@/components/ui/chip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

const STATUS_WORD: Record<GroupMemberStatus, string> = {
  idle: 'idle',
  working: 'working',
  'needs-you': 'needs you',
};

export function groupMemberStatusWord(status: GroupMemberStatus): string {
  return STATUS_WORD[status];
}

export interface GroupMemberActions {
  onOpenSession?: () => void;
  /** Interrupts the member's turn; offered while it works. */
  onStop?: () => void;
  onMakeDefault?: () => void;
  /** Absent when the group is at its minimum size. */
  onRemove?: () => void;
}

export interface GroupMemberChipProps extends GroupMemberActions {
  name: string;
  status: GroupMemberStatus;
  /** The member woken when a message names nobody. */
  isDefault?: boolean;
  /** The member's color in the thread. */
  colorClass?: string;
}

/** The status glyph: a spinner while working, a dot otherwise (amber when the member needs you). */
export function GroupMemberStatusGlyph({ status }: { status: GroupMemberStatus }) {
  return status === 'working' ? (
    <Loader2 className="size-3 animate-spin text-muted-foreground" aria-hidden />
  ) : (
    <span aria-hidden className={cn('size-2 rounded-full', status === 'needs-you' ? 'bg-warning' : 'bg-foreground/20')} />
  );
}

/** A member's menu items: the same set under its chip and under the overflow chip. */
export function GroupMemberMenuItems({ status, isDefault, onOpenSession, onStop, onMakeDefault, onRemove }: Pick<GroupMemberChipProps, 'status' | 'isDefault'> & GroupMemberActions) {
  return (
    <>
      {onOpenSession && (
        <DropdownMenuItem onClick={onOpenSession}>
          <MessageSquare className="size-4" />
          Open member session
        </DropdownMenuItem>
      )}
      {onStop && status === 'working' && (
        <DropdownMenuItem onClick={onStop}>
          <Square className="size-4" />
          Stop
        </DropdownMenuItem>
      )}
      {onMakeDefault && (
        <DropdownMenuItem disabled={isDefault} onClick={onMakeDefault}>
          <Star className="size-4" />
          {isDefault ? 'Default member' : 'Make default member'}
        </DropdownMenuItem>
      )}
      {onRemove && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={onRemove}>
            <UserMinus className="size-4" />
            Remove from group
          </DropdownMenuItem>
        </>
      )}
    </>
  );
}

/**
 * One member in the group header: its name in its thread color and what it
 * is doing right now. The menu opens the hidden member session (for the full
 * tool cards), stops the member while it works, makes it the default, or
 * removes it.
 */
export function GroupMemberChip({ name, status, isDefault, colorClass, ...actions }: GroupMemberChipProps) {
  const word = STATUS_WORD[status];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Chip aria-label={`${name}: ${word}${isDefault ? ', default member' : ''}`} title={`${name}: ${word}`} className="@max-lg/chips:px-2.5" data-status={status}>
          <GroupMemberStatusGlyph status={status} />
          <span className={cn('truncate font-medium', colorClass)}>{name}</span>
          {isDefault && <Star className="size-3 fill-current text-muted-foreground/70" aria-hidden />}
        </Chip>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        <GroupMemberMenuItems status={status} isDefault={isDefault} {...actions} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
