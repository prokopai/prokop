import type { Meta, StoryObj } from '@storybook/react-vite';
import type { AnyVisualization } from '@prokopai/sdk';
import { VisualizationRenderer } from './VisualizationRenderer';
import {
  createCodeVisualization,
  createDiffVisualization,
  createDiffsVisualization,
  createShellOutputVisualization,
} from '../../../.storybook/mocks/mockVisualization';

const meta = {
  title: 'Visualizations/ToolPreviews',
  component: VisualizationRenderer,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof VisualizationRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

const longLog = Array.from({ length: 40 }, (_, i) => `[${String(i + 1).padStart(2, '0')}] compiled module ${i + 1}`).join('\n');

const failedTests = createShellOutputVisualization({
  command: 'bun test',
  exitCode: 1,
  stdout: [
    'bun test v1.2.4',
    '',
    'src/auth/session.test.ts:',
    '✓ returns null without cookie',
    '✓ verifies a valid token',
    '✗ rejects an expired token',
    '  expected: null',
    '  received: { sub: "u1" }',
    '',
    ' 2 pass',
    ' 1 fail',
  ].join('\n'),
  stderr: 'error: 1 test failed',
});

const longFile = createCodeVisualization({
  path: 'src/auth/session.ts',
  content: Array.from({ length: 60 }, (_, i) => (i % 5 === 0 ? `export function step${i / 5}() {` : i % 5 === 4 ? '}' : `  const value${i} = compute(${i});`)).join('\n'),
  lineCount: 60,
  created: true,
  highlightLines: [],
});

const longDiff = createDiffVisualization({
  path: 'src/routes.ts',
  additions: 45,
  deletions: 0,
  hunks: [{
    oldStart: 1,
    oldLines: 0,
    newStart: 1,
    newLines: 45,
    changes: Array.from({ length: 45 }, (_, i) => ({ type: 'added' as const, content: `router.get('/path-${i + 1}', handler${i + 1});`, newLineNumber: i + 1 })),
  }],
});

/** The row above each preview, as the transcript draws it. */
function Row({ name, summary, chip, failed = false, children }: { name: string; summary: string; chip?: string; failed?: boolean; children: React.ReactNode }) {
  return (
    <div className="my-3">
      <div className={`flex items-center gap-2 py-1 text-xs ${failed ? 'text-destructive' : 'text-muted-foreground'}`}>
        <span className="opacity-60">›</span>
        <span>{name}</span>
        <span className={`font-mono ${failed ? '' : 'text-muted-foreground/70'}`}>{summary}</span>
        {chip && <span className={`ml-auto font-mono text-2xs ${failed ? 'text-destructive' : 'text-muted-foreground/70'}`}>{chip}</span>}
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

export const ShellShort: Story = {
  args: { visualization: createShellOutputVisualization(), persistKey: 'shell-short' },
};

export const ShellFolded: Story = {
  args: { visualization: createShellOutputVisualization({ command: 'bun run build', stdout: longLog }), persistKey: 'shell-folded' },
};

export const ShellFailed: Story = {
  args: { visualization: failedTests, persistKey: 'shell-failed' },
};

export const CodeShort: Story = {
  args: { visualization: createCodeVisualization(), persistKey: 'code-short' },
};

export const CodeFolded: Story = {
  args: { visualization: longFile, persistKey: 'code-folded' },
};

export const DiffShort: Story = {
  args: { visualization: createDiffVisualization(), persistKey: 'diff-short' },
};

export const DiffFolded: Story = {
  args: { visualization: longDiff, persistKey: 'diff-folded' },
};

export const SeveralFiles: Story = {
  args: { visualization: createDiffsVisualization(), persistKey: 'diffs' },
};

export const UnderToolRows: Story = {
  render: () => (
    <div className="mx-auto max-w-3xl">
      <Row name="write" summary="src/auth/session.ts" chip="60 lines · 0.4s">
        <VisualizationRenderer visualization={longFile as AnyVisualization} persistKey="rows-code" />
      </Row>
      <Row name="shell" summary="bun test" chip="exit 1 · 6.2s" failed>
        <VisualizationRenderer visualization={failedTests} persistKey="rows-shell" />
      </Row>
      <Row name="edit" summary="src/index.ts" chip="+3 −1 · 0.2s">
        <VisualizationRenderer visualization={createDiffVisualization()} persistKey="rows-diff" />
      </Row>
      <Row name="shell" summary="bun run build" chip="3.1s">
        <VisualizationRenderer visualization={createShellOutputVisualization({ stdout: longLog })} persistKey="rows-shell-long" />
      </Row>
    </div>
  ),
};
