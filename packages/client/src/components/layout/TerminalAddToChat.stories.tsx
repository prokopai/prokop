import { useEffect, useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { TerminalAddToChat } from './TerminalAddToChat';
import { createTerminalInstance } from '@/hooks/useTerminal';

/**
 * "Add to chat" appears over the terminal while text is selected. Select
 * some output below. Without a focused session the button is disabled.
 */

function Harness({ sessionId }: { sessionId: string | null }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const { terminal: term, fitAddon } = createTerminalInstance();
    term.open(host);
    fitAddon.fit();
    term.writeln('$ bun test');
    term.writeln('bun test v1.2.4');
    term.writeln('');
    term.writeln('src/auth/session.test.ts:');
    term.writeln('\u001b[32m✓\u001b[0m returns null without cookie');
    term.writeln('\u001b[31m✗\u001b[0m rejects an expired token');
    term.writeln('');
    term.writeln(' 1 pass');
    term.writeln(' 1 fail');
    // Preselect two lines so the control is visible on load.
    term.select(0, 4, 60);
    setTerminal(term);
    return () => term.dispose();
  }, []);
  return (
    <div className="relative flex h-72 w-[32rem] flex-col rounded-xl border bg-sidebar">
      <div ref={hostRef} className="min-h-0 flex-1 p-1" />
      {terminal && <TerminalAddToChat terminal={terminal} label="zsh" cwd="/home/user/my-project" sessionId={sessionId} />}
    </div>
  );
}

const meta = {
  title: 'Terminal/TerminalAddToChat',
  parameters: {
    layout: 'centered',
    smoke: 'skip: xterm renders to canvas and measures fonts; happy-dom has neither',
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithSession: Story = { render: () => <Harness sessionId="sess-1" /> };
export const NoSession: Story = { render: () => <Harness sessionId={null} /> };
