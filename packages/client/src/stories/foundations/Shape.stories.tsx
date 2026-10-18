import type { Meta, StoryObj } from '@storybook/react-vite';

/**
 * Radius, spacing, borders and elevation. Every radius derives from one
 * `--radius` token (0.5rem), so changing it reshapes every corner at once.
 */

const RADII = ['rounded-sm', 'rounded-md', 'rounded-lg', 'rounded-xl', 'rounded-2xl', 'rounded-3xl', 'rounded-full'] as const;
const SPACES = [0.5, 1, 1.5, 2, 3, 4, 6, 8, 12] as const;
const SHADOWS = ['shadow-xs', 'shadow-sm', 'shadow-md', 'shadow-lg', 'shadow-xl'] as const;

function Radius() {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">Radius</h2>
      <div className="flex flex-wrap gap-4">
        {RADII.map((cls) => (
          <div key={cls} className="flex flex-col items-center gap-1.5">
            <div className={`h-16 w-16 border border-border bg-card ${cls}`} />
            <span className="font-mono text-2xs text-muted-foreground">{cls}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Spacing() {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">Spacing</h2>
      <div className="flex flex-col gap-2">
        {SPACES.map((step) => (
          <div key={step} className="flex items-center gap-4">
            <span className="w-10 font-mono text-2xs text-muted-foreground">{step}</span>
            <div className="h-3 bg-primary/70" style={{ width: `${step * 0.25}rem` }} />
            <span className="text-2xs text-muted-foreground">{step * 4}px</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Lines() {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">Lines and fills</h2>
      <div className="flex flex-wrap gap-4">
        <div className="flex h-16 w-40 items-center justify-center rounded-lg border border-border text-2xs text-muted-foreground">border</div>
        <div className="flex h-16 w-40 items-center justify-center rounded-lg border border-input text-2xs text-muted-foreground">border-input</div>
        <div className="flex h-16 w-40 items-center justify-center rounded-lg border border-dashed border-border text-2xs text-muted-foreground">dashed</div>
        <div className="flex h-16 w-40 items-center justify-center rounded-lg bg-muted text-2xs text-muted-foreground">bg-muted</div>
        <div className="flex h-16 w-40 items-center justify-center rounded-lg bg-muted/40 text-2xs text-muted-foreground">bg-muted/40</div>
        <div className="flex h-16 w-40 items-center justify-center rounded-lg bg-accent text-2xs text-accent-foreground">bg-accent</div>
      </div>
    </section>
  );
}

function Elevation() {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">Elevation</h2>
      <div className="flex flex-wrap gap-6 rounded-xl bg-background p-6">
        {SHADOWS.map((cls) => (
          <div key={cls} className={`flex h-20 w-32 items-end rounded-lg border border-border bg-popover p-2 ${cls}`}>
            <span className="font-mono text-2xs text-muted-foreground">{cls}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Page() {
  return (
    <div className="flex flex-col gap-8 p-6">
      <Radius />
      <Spacing />
      <Lines />
      <Elevation />
    </div>
  );
}

const meta = {
  title: 'Foundations/Shape',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: () => <Page /> };
