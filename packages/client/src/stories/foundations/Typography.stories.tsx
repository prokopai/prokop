import type { Meta, StoryObj } from '@storybook/react-vite';

/**
 * Type scale and families. `text-2xs` (11 px) is the floor: meta, durations,
 * counts. Nothing in the interface goes below it.
 */

const SIZES = [
  { cls: 'text-2xs', use: 'durations, counts, meta' },
  { cls: 'text-xs', use: 'secondary labels, tool rows' },
  { cls: 'text-sm', use: 'body: transcript, settings, menus' },
  { cls: 'text-base', use: 'composer, dialog titles' },
  { cls: 'text-lg', use: 'section headings' },
  { cls: 'text-xl', use: 'empty-state titles' },
  { cls: 'text-2xl', use: 'first-run screens' },
] as const;

const WEIGHTS = ['font-normal', 'font-medium', 'font-semibold'] as const;

function Scale() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Sizes</h2>
        <div className="grid grid-cols-[8rem_1fr_12rem] items-baseline gap-x-6 gap-y-3">
          {SIZES.map(({ cls, use }) => (
            <div key={cls} className="contents">
              <span className="font-mono text-2xs text-muted-foreground">{cls}</span>
              <span className={cls}>The quick brown fox jumps over the lazy dog</span>
              <span className="text-2xs text-muted-foreground">{use}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Weights</h2>
        <div className="flex flex-col gap-2">
          {WEIGHTS.map((weight) => (
            <div key={weight} className="flex items-baseline gap-6">
              <span className="w-32 font-mono text-2xs text-muted-foreground">{weight}</span>
              <span className={`text-sm ${weight}`}>Refactor the auth module and keep the public API</span>
            </div>
          ))}
        </div>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Families</h2>
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline gap-6">
            <span className="w-32 font-mono text-2xs text-muted-foreground">font-sans</span>
            <span className="text-sm">Geist Variable. Interface text, transcript prose.</span>
          </div>
          <div className="flex items-baseline gap-6">
            <span className="w-32 font-mono text-2xs text-muted-foreground">font-mono</span>
            <span className="font-mono text-sm">ui-monospace. Paths, commands, code, diffs.</span>
          </div>
        </div>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Color roles</h2>
        <div className="flex flex-col gap-1 text-sm">
          <span className="text-foreground">foreground: primary reading text</span>
          <span className="text-muted-foreground">muted-foreground: meta, hints, timestamps</span>
          <span className="text-destructive">destructive: errors and irreversible actions</span>
          <span className="text-success">success</span>
          <span className="text-warning">warning</span>
          <span className="text-error">error</span>
        </div>
      </section>
    </div>
  );
}

/** A transcript-like paragraph set at body size, for line length and rhythm. */
function Reading() {
  return (
    <div className="mx-auto max-w-prose select-text p-6 text-sm leading-6">
      <h1 className="mb-2 text-lg font-semibold">Reading sample</h1>
      <p className="mb-3">
        The server keeps one SQLite file per workspace. Sessions, messages and parts live in it; attachments are stored beside it
        on disk. When a client connects it receives the critical data first (workspaces, models, preconfigs) and the rest as it
        arrives.
      </p>
      <p className="mb-3">
        Inline code such as <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">bun run dev</code> keeps the mono
        family. A <a className="underline underline-offset-4" href="#top">link</a> is underlined, not colored.
      </p>
      <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-5">
{`export function isMobileViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT;
}`}
      </pre>
      <p className="mt-3 text-2xs text-muted-foreground">2 min ago, 1.2k tokens</p>
    </div>
  );
}

const meta = {
  title: 'Foundations/Typography',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: () => <Scale /> };
export const ReadingSample: Story = { render: () => <Reading /> };
