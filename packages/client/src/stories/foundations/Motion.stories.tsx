import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '@/components/ui/button';

/**
 * The named animations from `src/index.css`. Replay restarts them all.
 * `prefers-reduced-motion` collapses every one of these to a frame.
 */

const ANIMATIONS = [
  { cls: 'animate-fade-in', use: 'new rows, chips' },
  { cls: 'animate-slide-up', use: 'docks on phones' },
  { cls: 'animate-slide-in-right', use: 'right dock' },
  { cls: 'animate-pulse-soft', use: 'running tool, waiting ask' },
  { cls: 'animate-blink', use: 'caret' },
  { cls: 'animate-stream-cursor', use: 'streaming cursor' },
  { cls: 'animate-appear-late', use: 'loading indicators after 300ms' },
  { cls: 'animate-spin', use: 'spinners' },
] as const;

function Gallery() {
  const [run, setRun] = useState(0);
  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <Button variant="outline" size="sm" onClick={() => setRun((n) => n + 1)}>Replay</Button>
      </div>
      <div key={run} className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-6">
        {ANIMATIONS.map(({ cls, use }) => (
          <div key={cls} className="flex flex-col gap-2">
            <div className="flex h-24 items-center justify-center overflow-hidden rounded-lg border border-border bg-card">
              <div className={`h-8 w-8 rounded-md bg-primary ${cls}`} />
            </div>
            <span className="font-mono text-2xs">{cls}</span>
            <span className="text-2xs text-muted-foreground">{use}</span>
          </div>
        ))}
      </div>
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Streamed text</h2>
        <p key={`stream-${run}`} className="max-w-prose text-sm">
          {'Words arrive in flushes and fade in once, staggered per flush.'.split(' ').map((word, index) => (
            <span key={index} className="stream-in" style={{ animationDelay: `${index * 40}ms` }}>{word} </span>
          ))}
        </p>
      </section>
    </div>
  );
}

const meta = {
  title: 'Foundations/Motion',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: () => <Gallery /> };
