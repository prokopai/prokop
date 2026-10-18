import { useEffect, useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { TerminalKeyBar } from './TerminalKeyBar';
import { createTerminalInstance } from '@/hooks/useTerminal';

/**
 * Keys a phone keyboard lacks, under the touch terminal. Taps write the
 * sequence into the terminal below (local echo only in this story).
 */

function Harness() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const { terminal: term, fitAddon } = createTerminalInstance();
    term.open(host);
    fitAddon.fit();
    term.writeln('Tap a key below; bytes echo here:');
    term.onData((data) => term.write(JSON.stringify(data).slice(1, -1)));
    setTerminal(term);
    return () => term.dispose();
  }, []);
  return (
    <div className="flex h-72 w-[24rem] flex-col rounded-xl border bg-sidebar">
      <div ref={hostRef} className="min-h-0 flex-1 p-1" />
      {terminal && <TerminalKeyBar terminal={terminal} />}
    </div>
  );
}

const meta = {
  title: 'Terminal/TerminalKeyBar',
  parameters: {
    layout: 'centered',
    smoke: 'skip: xterm renders to canvas and measures fonts; happy-dom has neither',
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: () => <Harness /> };

export const Phone: Story = {
  render: () => <Harness />,
  globals: { viewport: { value: 'phone' } },
};
