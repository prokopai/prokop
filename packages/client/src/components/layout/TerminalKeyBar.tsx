import type { Terminal } from '@xterm/xterm';

interface TerminalKey {
  label: string;
  title: string;
  /** Bytes for the shell; arrows depend on the application cursor mode. */
  sequence: (applicationCursor: boolean) => string;
}

const arrow = (final: string) => (applicationCursor: boolean) => `\x1b${applicationCursor ? 'O' : '['}${final}`;

const TERMINAL_KEYS: TerminalKey[] = [
  { label: '^C', title: 'Ctrl+C (interrupt)', sequence: () => '\x03' },
  { label: 'Esc', title: 'Escape', sequence: () => '\x1b' },
  { label: 'Tab', title: 'Tab', sequence: () => '\t' },
  { label: '↑', title: 'Up', sequence: arrow('A') },
  { label: '↓', title: 'Down', sequence: arrow('B') },
  { label: '←', title: 'Left', sequence: arrow('D') },
  { label: '→', title: 'Right', sequence: arrow('C') },
];

/**
 * Keys a phone keyboard lacks, under the touch terminal. Taps keep focus
 * where it is, so they neither open nor close the on-screen keyboard.
 */
export function TerminalKeyBar({ terminal }: { terminal: Terminal }) {
  return (
    <div role="toolbar" aria-label="Terminal keys" className="flex shrink-0 items-center gap-1 overflow-x-auto border-t border-border/50 px-1 py-1">
      {TERMINAL_KEYS.map((key) => (
        <button
          key={key.label}
          type="button"
          aria-label={key.title}
          title={key.title}
          className="h-8 min-w-10 shrink-0 touch-manipulation rounded-md bg-muted px-2 font-mono text-xs text-foreground active:bg-accent"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => terminal.input(key.sequence(terminal.modes.applicationCursorKeysMode), true)}
        >
          {key.label}
        </button>
      ))}
    </div>
  );
}
