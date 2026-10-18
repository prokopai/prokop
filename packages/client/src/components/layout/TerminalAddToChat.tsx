import { useEffect, useState } from 'react';
import type { Terminal } from '@xterm/xterm';
import { MessageSquarePlus } from 'lucide-react';
import { createContextReferenceId } from '@prokopai/sdk';
import { insertIntoComposer } from '@/lib/composerTargets';
import { cn } from '@/lib/utils';

/** Captured output beyond this keeps its last lines; prompts stay a sane size. */
export const TERMINAL_CONTEXT_MAX_CHARS = 32_000;

/** Selected terminal text without trailing blank space, capped from the end. */
export function normalizeTerminalSelection(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((line) => line.trimEnd());
  while (lines.length > 0 && !lines[0]) lines.shift();
  while (lines.length > 0 && !lines.at(-1)) lines.pop();
  const joined = lines.join('\n');
  if (joined.length <= TERMINAL_CONTEXT_MAX_CHARS) return joined;
  const tail = joined.slice(-TERMINAL_CONTEXT_MAX_CHARS);
  return tail.slice(tail.indexOf('\n') + 1);
}

interface TerminalAddToChatProps {
  terminal: Terminal;
  /** Tab title or shell, shown on the chip. */
  label: string;
  cwd?: string;
  /** Session whose composer receives the output; null when no session is focused. */
  sessionId: string | null;
}

/** A quiet button over the terminal while text is selected: sends the selection to the chat composer. */
export function TerminalAddToChat({ terminal, label, cwd, sessionId }: TerminalAddToChatProps) {
  const [hasSelection, setHasSelection] = useState(() => terminal.hasSelection());

  useEffect(() => {
    const subscription = terminal.onSelectionChange(() => setHasSelection(terminal.hasSelection()));
    return () => subscription.dispose();
  }, [terminal]);

  if (!hasSelection) return null;

  const add = () => {
    const text = normalizeTerminalSelection(terminal.getSelection());
    if (!sessionId || !text) return;
    insertIntoComposer(sessionId, {
      kind: 'terminal',
      id: createContextReferenceId(),
      label,
      ...(cwd ? { cwd } : {}),
      text,
    });
    terminal.clearSelection();
  };

  return (
    <button
      type="button"
      // Keep the selection: a mousedown here would otherwise clear it before the click.
      onMouseDown={(event) => event.preventDefault()}
      onClick={add}
      disabled={!sessionId}
      title={sessionId ? 'Add the selected output to the chat' : 'Open a session to add output to its chat'}
      className={cn(
        'absolute top-2 right-3 z-10 flex items-center gap-1.5 rounded-md border border-border/50 bg-popover/95 px-2 py-1 text-xs text-popover-foreground shadow-sm',
        'transition-colors hover:bg-accent disabled:opacity-50 disabled:hover:bg-popover/95',
      )}
    >
      <MessageSquarePlus className="size-3.5" />
      Add to chat
    </button>
  );
}
