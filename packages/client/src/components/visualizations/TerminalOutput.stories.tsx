import type { Meta, StoryObj } from '@storybook/react-vite';
import { TerminalOutput } from './TerminalOutput';

/** Output of a shell tool call: stdout, stderr, exit code, and whether it is still running. */

const longLog = Array.from({ length: 40 }, (_, i) => `[${String(i + 1).padStart(2, '0')}] compiled module ${i + 1}`).join('\n');

const meta = {
  title: 'Visualizations/TerminalOutput',
  component: TerminalOutput,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof TerminalOutput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Succeeded: Story = {
  args: { stdout: 'bun test v1.2.4\n\n 12 pass\n 0 fail\n', exitCode: 0 },
};

export const Failed: Story = {
  args: {
    stdout: 'bun test v1.2.4\n\nsrc/auth/session.test.ts:\n✓ returns null without cookie\n✗ rejects an expired token\n',
    stderr: 'error: 1 test failed',
    exitCode: 1,
  },
};

export const Running: Story = {
  args: { stdout: 'Building…\n[1/4] resolving\n[2/4] transforming', status: 'running' },
};

export const Killed: Story = {
  args: { stdout: 'watching for changes…', status: 'killed' },
};

export const Folded: Story = {
  args: { stdout: longLog, exitCode: 0, vizKey: 'terminal-folded' },
};

export const NoOutput: Story = {
  args: { exitCode: 0 },
};

export const AnsiColors: Story = {
  args: { stdout: '\u001b[32m✓\u001b[0m passed  \u001b[31m✗\u001b[0m failed  \u001b[33mwarning\u001b[0m  \u001b[1mbold\u001b[0m', exitCode: 0 },
};
