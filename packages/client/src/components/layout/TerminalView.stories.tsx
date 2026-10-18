import { useMemo } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import '@xterm/xterm/css/xterm.css';
import { TerminalView } from './TerminalView';
import { createTerminalInstance, type CachedTerminal } from '@/hooks/useTerminal';

/** The xterm surface of one terminal tab; it fits to its container and refits on resize. */

function Harness({ visible, lines }: { visible: boolean; lines: string[] }) {
  const cached = useMemo<CachedTerminal>(() => {
    const { terminal, fitAddon } = createTerminalInstance();
    for (const line of lines) terminal.writeln(line);
    return { terminal, fitAddon, serverSessionId: 'term-1', status: 'connected', isOpened: false };
  }, [lines]);
  return (
    <div className="h-screen bg-sidebar p-2">
      <TerminalView cachedTerminal={cached} visible={visible} />
    </div>
  );
}

const sample = [
  '$ bun run dev',
  '\u001b[36m[server]\u001b[0m listening on http://localhost:3000',
  '\u001b[36m[client]\u001b[0m  VITE v8.0.8  ready in 412 ms',
  '',
  '  ➜  Local:   http://localhost:5173/',
  '  ➜  Network: use --host to expose',
];

const meta = {
  title: 'Terminal/TerminalView',
  parameters: {
    layout: 'fullscreen',
    smoke: 'skip: xterm renders to canvas and measures fonts; happy-dom has neither',
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: () => <Harness visible lines={sample} /> };

export const LongScrollback: Story = {
  render: () => <Harness visible lines={Array.from({ length: 300 }, (_, i) => `[${String(i + 1).padStart(3, '0')}] compiled module ${i + 1}`)} />,
};

export const Hidden: Story = { render: () => <Harness visible={false} lines={sample} /> };
