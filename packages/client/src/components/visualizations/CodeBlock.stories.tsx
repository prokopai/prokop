import type { Meta, StoryObj } from '@storybook/react-vite';
import { CodeBlock } from './CodeBlock';

/** A file's content under a tool row: folded past the render budget, with the path optional. */

const short = `export function isMobileViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT;
}`;

const long = Array.from({ length: 80 }, (_, i) => (
  i % 5 === 0 ? `export function step${i / 5}() {` : i % 5 === 4 ? '}' : `  const value${i} = compute(${i});`
)).join('\n');

const meta: Meta<typeof CodeBlock> = {
  title: 'Visualizations/CodeBlock',
  component: CodeBlock,
  parameters: { layout: 'padded' },
  args: { path: 'src/lib/viewport.ts', content: short, language: 'typescript' },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithPath: Story = {
  args: { showPath: true },
};

export const Folded: Story = {
  args: { path: 'src/generated/steps.ts', content: long, vizKey: 'code-folded' },
};

export const HighlightedLines: Story = {
  args: { path: 'src/generated/steps.ts', content: long, highlightLines: [2, 3, 7], vizKey: 'code-highlight' },
};

export const Markdown: Story = {
  args: { path: 'README.md', language: 'markdown', content: '# Title\n\nSome **bold** text and a list:\n\n- one\n- two\n' },
};

export const Empty: Story = {
  args: { path: 'src/empty.ts', content: '' },
};
