import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { ContextChip } from './ContextChip';

/** A file, folder or terminal reference as it appears in the composer and in sent prompts. */

const meta = {
  title: 'Chat/ContextChip',
  component: ContextChip,
  parameters: { layout: 'centered' },
  args: { onOpenFile: fn() },
  decorators: [(Story) => <div className="flex flex-wrap items-center gap-2 text-sm"><Story /></div>],
} satisfies Meta<typeof ContextChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const File: Story = {
  args: { reference: { kind: 'file', path: 'src/components/chat/ContextChip.tsx' } },
};

export const FileWithLines: Story = {
  args: { reference: { kind: 'file', path: 'src/auth/session.ts', lineStart: 42, lineEnd: 58 } },
};

export const Folder: Story = {
  args: { reference: { kind: 'file', path: 'src/components/' } },
};

export const Terminal: Story = {
  args: { reference: { kind: 'terminal', id: 'term-1', label: 'zsh', cwd: '/home/user/my-project', text: '$ bun test\n 12 pass\n 0 fail' } },
};

export const Selected: Story = {
  args: { reference: { kind: 'file', path: 'src/index.ts' }, selected: true },
};

export const MissingTerminal: Story = {
  args: { reference: undefined, label: 'zsh (output missing)' },
};

export const LongPath: Story = {
  args: { reference: { kind: 'file', path: 'packages/client/src/components/modals/configuration/providers-models/ModelEditorForm.tsx', lineStart: 120 } },
};
