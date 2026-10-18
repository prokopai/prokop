import type { Meta, StoryObj } from '@storybook/react-vite';
import { THEME_MODES, THEME_SCHEMES, SCHEME_LABELS } from '../../../.storybook/theme-addon/constants';

/**
 * The color tokens from `src/index.css`. Swatches read the live CSS variables,
 * so the Mode and Scheme toolbar switch them. Edit a token, open this story,
 * then open the layers above (Primitives, Chat, Workspace) to see where it lands.
 */

interface TokenPair {
  /** CSS variable without the leading dashes. */
  token: string;
  /** Variable used for text on top of the token, if it has one. */
  foreground?: string;
  note?: string;
}

const SURFACE_TOKENS: TokenPair[] = [
  { token: 'background', foreground: 'foreground', note: 'the desk' },
  { token: 'card', foreground: 'card-foreground', note: 'panels on the desk' },
  { token: 'popover', foreground: 'popover-foreground', note: 'menus, tooltips' },
  { token: 'sidebar', foreground: 'sidebar-foreground', note: 'docks' },
  { token: 'sidebar-accent', foreground: 'sidebar-accent-foreground', note: 'hovered dock row' },
];

const CONTROL_TOKENS: TokenPair[] = [
  { token: 'primary', foreground: 'primary-foreground' },
  { token: 'secondary', foreground: 'secondary-foreground' },
  { token: 'accent', foreground: 'accent-foreground', note: 'hover, selection' },
  { token: 'muted', foreground: 'muted-foreground', note: 'quiet fills, meta text' },
  { token: 'destructive', foreground: 'primary-foreground' },
];

const LINE_TOKENS: TokenPair[] = [
  { token: 'border' },
  { token: 'input' },
  { token: 'ring', note: 'focus' },
  { token: 'sidebar-border' },
  { token: 'sidebar-ring' },
];

const STATUS_TOKENS: TokenPair[] = [
  { token: 'success' },
  { token: 'warning' },
  { token: 'error' },
];

const CHART_TOKENS: TokenPair[] = [1, 2, 3, 4, 5].map((n) => ({ token: `chart-${n}` }));

const FILE_TOKENS: TokenPair[] = ['ts', 'js', 'json', 'md', 'css', 'html', 'folder', 'default'].map((kind) => ({
  token: `file-icon-${kind}`,
}));

function Swatch({ token, foreground, note }: TokenPair) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="flex h-16 items-end rounded-lg border px-2 py-1.5 text-xs"
        style={{
          background: `var(--${token})`,
          color: foreground ? `var(--${foreground})` : undefined,
          borderColor: 'var(--border)',
        }}
      >
        {foreground ? 'Aa' : null}
      </div>
      <div className="font-mono text-2xs text-foreground">--{token}</div>
      {note ? <div className="text-2xs text-muted-foreground">{note}</div> : null}
    </div>
  );
}

function TokenGroup({ title, tokens }: { title: string; tokens: TokenPair[] }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">{title}</h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-4">
        {tokens.map((pair) => <Swatch key={pair.token} {...pair} />)}
      </div>
    </section>
  );
}

function TokensPage() {
  return (
    <div className="flex flex-col gap-8 p-6">
      <TokenGroup title="Surfaces" tokens={SURFACE_TOKENS} />
      <TokenGroup title="Controls" tokens={CONTROL_TOKENS} />
      <TokenGroup title="Lines" tokens={LINE_TOKENS} />
      <TokenGroup title="Status" tokens={STATUS_TOKENS} />
      <TokenGroup title="Charts" tokens={CHART_TOKENS} />
      <TokenGroup title="File icons" tokens={FILE_TOKENS} />
    </div>
  );
}

const MATRIX_TOKENS = ['background', 'card', 'popover', 'primary', 'accent', 'muted', 'border', 'success', 'warning', 'error'];

/** Every mode and scheme at once, independent of the toolbar. */
function SchemeMatrix() {
  return (
    <div className="grid gap-4 p-6 md:grid-cols-2">
      {THEME_MODES.flatMap((mode) => THEME_SCHEMES.map((scheme) => (
        <div key={`${mode}-${scheme}`} className={`${mode} ${scheme} rounded-xl border border-border bg-background p-4 text-foreground`}>
          <div className="mb-3 flex items-baseline justify-between">
            <span className="text-sm font-medium">{SCHEME_LABELS[scheme]}</span>
            <span className="text-2xs text-muted-foreground">{mode}</span>
          </div>
          <div className="flex gap-1.5">
            {MATRIX_TOKENS.map((token) => (
              <div key={token} title={`--${token}`} className="h-8 flex-1 rounded-md border border-border" style={{ background: `var(--${token})` }} />
            ))}
          </div>
          <div className="mt-3 rounded-lg border border-border bg-card p-3 text-card-foreground">
            <div className="text-sm">Card on the desk</div>
            <div className="text-2xs text-muted-foreground">muted meta text</div>
            <div className="mt-2 flex gap-2">
              <span className="rounded-md bg-primary px-2 py-1 text-2xs text-primary-foreground">primary</span>
              <span className="rounded-md bg-secondary px-2 py-1 text-2xs text-secondary-foreground">secondary</span>
              <span className="rounded-md bg-accent px-2 py-1 text-2xs text-accent-foreground">accent</span>
            </div>
          </div>
        </div>
      )))}
    </div>
  );
}

/** How the three surface levels stack, with a focus ring and a selection. */
function Layering() {
  return (
    <div className="h-full min-h-[24rem] bg-background p-6 text-foreground">
      <div className="rounded-xl border border-border bg-card p-4 text-card-foreground">
        <div className="text-sm font-medium">Card</div>
        <div className="mt-1 text-xs text-muted-foreground">Panels, docks and the composer sit here.</div>
        <div className="mt-4 flex gap-3">
          <div className="rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-md">
            <div className="text-xs font-medium">Popover</div>
            <div className="mt-1 text-2xs text-muted-foreground">Menus and tooltips.</div>
          </div>
          <div className="rounded-lg bg-sidebar p-3 text-sidebar-foreground">
            <div className="text-xs font-medium">Sidebar</div>
            <div className="mt-1 rounded-md bg-sidebar-accent px-2 py-1 text-2xs text-sidebar-accent-foreground">hovered row</div>
          </div>
          <button type="button" className="h-8 rounded-md border border-input bg-background px-3 text-xs ring-2 ring-ring ring-offset-2 ring-offset-background">
            focus ring
          </button>
        </div>
        <p className="mt-4 select-text text-xs">
          Select this text to see <span className="bg-[color-mix(in_oklch,var(--primary)_20%,transparent)]">the selection color</span>.
        </p>
      </div>
    </div>
  );
}

const meta = {
  title: 'Foundations/Colors',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tokens: Story = { render: () => <TokensPage /> };
export const AllSchemes: Story = { render: () => <SchemeMatrix /> };
export const Surfaces: Story = { render: () => <Layering /> };
