import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Bot, X } from 'lucide-react';
import type { TerminalStatus } from '@/hooks/useTerminal';
import { useSessionStore } from '@/stores/sessionStore';
import { useTabDrag, type TabDragKind } from '@/components/app/useWorkspaceTabDrag';
import { cn } from '@/lib/utils';

export interface TerminalTab {
  serverSessionId: string;
  title: string;
  status: TerminalStatus;
  cwd: string;
  shell: string;
  origin: 'user' | 'agent';
  /** Chat session whose agent created the terminal. */
  ownerSessionId?: string;
}

interface TerminalTabStripProps {
  tabs: TerminalTab[];
  activeId: string | null;
  compact?: boolean;
  /** Selects the tab and moves focus into its shell. */
  onActivate: (serverSessionId: string) => void;
  onClose: (serverSessionId: string) => void;
  onRename: (serverSessionId: string, title: string) => void;
  /** Drops a dragged tab before another (or at the end, for null). */
  onMove?: (serverSessionId: string, beforeId: string | null) => void;
  /** Rendered after the tabs (the new-terminal control). */
  trailing?: ReactNode;
}

const OWNER_SEPARATOR = '\u0000';

const TERMINAL_TAB_DRAG: TabDragKind = {
  type: 'application/x-prokop-terminal-tab',
  idAttribute: 'data-terminal-tab-id',
};

function statusIndicator(status: TerminalStatus): string {
  switch (status) {
    case 'connecting': return 'bg-warning';
    case 'connected': return 'bg-success';
    case 'disconnected': return 'bg-muted-foreground';
    case 'exited': return 'bg-error';
  }
}

/** Titles of the chat sessions that own agent terminals, keyed by session
 * id. Selects one string so unrelated session updates do not re-render. */
function useOwnerTitles(tabs: TerminalTab[]): Map<string, string> {
  const ownerIds = tabs.flatMap((tab) => tab.ownerSessionId ? [tab.ownerSessionId] : []);
  const joined = useSessionStore((state) => ownerIds
    .map((id) => state.sessions.find((session) => session.id === id)?.title ?? '')
    .join(OWNER_SEPARATOR));
  const titles = joined.split(OWNER_SEPARATOR);
  return new Map(ownerIds.map((id, index) => [id, titles[index] ?? '']));
}

function tabTooltip(tab: TerminalTab, ownerTitle: string | undefined): string {
  const lines = [`${tab.title} · ${tab.cwd}`];
  if (tab.origin === 'agent') {
    lines.push(ownerTitle ? `Started by the agent in “${ownerTitle}”` : 'Started by an agent');
  }
  lines.push('Double-click or F2 to rename');
  return lines.join('\n');
}

/**
 * Terminal tabs as a keyboard tablist with manual activation: arrows,
 * Home and End move between tabs, Enter or Space opens the shell, F2
 * renames and Delete closes. Renames go to the server; the panel picks up
 * the title_changed event like any other title change.
 */
export function TerminalTabStrip({
  tabs,
  activeId,
  compact = false,
  onActivate,
  onClose,
  onRename,
  onMove,
  trailing,
}: TerminalTabStripProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const tabRefs = useRef(new Map<string, HTMLDivElement>());
  const scrollerRef = useRef<HTMLDivElement>(null);
  const drag = useTabDrag(scrollerRef, TERMINAL_TAB_DRAG, onMove);
  const ownerTitles = useOwnerTitles(tabs);

  const focusTabAt = (index: number) => {
    const tab = tabs[(index + tabs.length) % tabs.length];
    if (tab) tabRefs.current.get(tab.serverSessionId)?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number, tab: TerminalTab) => {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
    switch (event.key) {
      case 'ArrowLeft': focusTabAt(index - 1); break;
      case 'ArrowRight': focusTabAt(index + 1); break;
      case 'Home': focusTabAt(0); break;
      case 'End': focusTabAt(tabs.length - 1); break;
      case 'Enter':
      case ' ':
        onActivate(tab.serverSessionId);
        break;
      case 'F2': setEditingId(tab.serverSessionId); break;
      case 'Delete':
      case 'Backspace':
        if (tabs.length > 1) focusTabAt(index === tabs.length - 1 ? index - 1 : index + 1);
        onClose(tab.serverSessionId);
        break;
      default: return;
    }
    event.preventDefault();
  };

  const finishRename = (tab: TerminalTab, title: string | null) => {
    setEditingId(null);
    const trimmed = title?.trim();
    if (trimmed && trimmed !== tab.title) onRename(tab.serverSessionId, trimmed);
    tabRefs.current.get(tab.serverSessionId)?.focus();
  };

  return (
    <div ref={scrollerRef} {...drag.stripEvents} className={cn(
      'relative flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto',
      compact ? 'min-h-0' : 'min-h-[32px] px-1',
      drag.insertion && 'bg-primary/5 ring-1 ring-inset ring-primary/30',
    )}>
      <div role="tablist" aria-label="Terminals" className="flex items-center gap-0.5">
        {tabs.map((tab, index) => {
          const active = tab.serverSessionId === activeId;
          const ownerTitle = tab.ownerSessionId ? ownerTitles.get(tab.ownerSessionId) : undefined;
          return (
            <div
              key={tab.serverSessionId}
              ref={(element) => {
                if (element) tabRefs.current.set(tab.serverSessionId, element);
                else tabRefs.current.delete(tab.serverSessionId);
              }}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              data-terminal-tab-id={tab.serverSessionId}
              draggable={!!onMove && editingId !== tab.serverSessionId}
              onDragStart={(event) => drag.start(tab.serverSessionId, event)}
              title={editingId === tab.serverSessionId ? undefined : tabTooltip(tab, ownerTitle)}
              className={cn(
                'group flex items-center gap-1.5 px-2 text-xs rounded-md whitespace-nowrap border border-transparent outline-none focus-visible:border-ring',
                compact ? 'py-0.5' : 'py-1',
                active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted',
              )}
              onClick={() => onActivate(tab.serverSessionId)}
              onDoubleClick={() => setEditingId(tab.serverSessionId)}
              onKeyDown={(event) => handleKeyDown(event, index, tab)}
            >
              <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', statusIndicator(tab.status))} />
              {tab.origin === 'agent' && (
                <Bot aria-label="Started by an agent" className="size-3 shrink-0 text-muted-foreground" />
              )}
              {editingId === tab.serverSessionId ? (
                <TabRenameInput
                  initial={tab.title}
                  onDone={(title) => finishRename(tab, title)}
                />
              ) : (
                <span className="max-w-48 truncate">{tab.title}</span>
              )}
              <button
                type="button"
                tabIndex={-1}
                aria-label={`Close terminal ${tab.title}`}
                className={cn(
                  'hover:text-destructive transition-opacity ml-0.5',
                  // Touch has no hover, so the full-size strip keeps close visible.
                  compact && 'opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100',
                )}
                onClick={(event) => { event.stopPropagation(); onClose(tab.serverSessionId); }}
              >
                <X className="size-3" />
              </button>
            </div>
          );
        })}
      </div>
      {trailing}
      {drag.insertion && <span data-tab-insertion-marker aria-hidden="true" className="pointer-events-none absolute top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary" style={{ left: Math.max(0, drag.insertion.left - 1) }} />}
    </div>
  );
}

function TabRenameInput({ initial, onDone }: { initial: string; onDone: (title: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const doneRef = useRef(false);
  const finish = (title: string | null) => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone(title);
  };

  return (
    <input
      autoFocus
      data-terminal-rename=""
      aria-label="Terminal name"
      value={value}
      maxLength={80}
      size={Math.max(4, value.length)}
      className="min-w-0 bg-transparent text-xs text-foreground outline-none"
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') finish(value);
        else if (event.key === 'Escape') finish(null);
      }}
      onBlur={() => finish(value)}
    />
  );
}
