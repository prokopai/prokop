import { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { StreamingReasoning, StreamingText } from './StreamingMessageText';

/**
 * Streamed markdown: finished blocks are memoized, the growing tail re-parses,
 * and the newest words fade in. `Live` replays a stream in flushes.
 */

const full = `# Project README

This is a comprehensive project that does several things well.

## Features

- Streams text in **flushes**, not per frame
- Keeps finished blocks memoized
- Fades the newest words in through CSS

## Installation

\`\`\`bash
bun install
bun run dev
\`\`\`

Open the client, pick a workspace, and start a session. The composer accepts file references with \`@\`.`;

function Live({ reasoning, intervalMs }: { reasoning: boolean; intervalMs: number }) {
  const [length, setLength] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setLength((n) => (n >= full.length ? n : n + 12 + Math.floor(Math.random() * 20))), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  const text = full.slice(0, length);
  const active = length < full.length;
  return (
    <div className="max-w-2xl">
      {reasoning ? <StreamingReasoning text={text} active={active} /> : <StreamingText text={text} active={active} />}
    </div>
  );
}

const meta = {
  title: 'Chat/StreamingMessageText',
  parameters: { layout: 'padded' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const LiveText: Story = {
  render: () => <Live reasoning={false} intervalMs={120} />,
};

export const LiveReasoning: Story = {
  render: () => <Live reasoning intervalMs={80} />,
};

export const Finished: Story = {
  render: () => <div className="max-w-2xl"><StreamingText text={full} active={false} /></div>,
};

export const ActiveTailOnly: Story = {
  render: () => <div className="max-w-2xl"><StreamingText text="Working through the first paragraph of a reply that is still" active /></div>,
};
