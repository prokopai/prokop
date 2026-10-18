import type { Meta, StoryObj } from '@storybook/react-vite';
import { FileListViewer } from './FileListViewer';

/** Files a tool touched or found, flat or grouped by action. */

const meta = {
  title: 'Visualizations/FileListViewer',
  component: FileListViewer,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof FileListViewer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Flat: Story = {
  args: {
    title: 'Matches',
    files: [
      { path: 'src/components/chat/ChatView.tsx', line: 42, content: 'const session = useSessionById(sessionId);' },
      { path: 'src/components/chat/MessageInput.tsx', line: 118, content: 'const session = useSessionById(props.sessionId);' },
      { path: 'src/hooks/useSessionDraft.ts', line: 7 },
    ],
    total: 3,
    singularLabel: 'match',
    pluralLabel: 'matches',
  },
};

export const Grouped: Story = {
  args: {
    title: 'Changed files',
    groups: [
      { label: 'Created', icon: 'plus', files: [{ path: 'src/lib/newHelper.ts', action: 'created' }] },
      { label: 'Modified', icon: 'edit', files: [{ path: 'src/index.ts', action: 'modified' }, { path: 'package.json', action: 'modified' }] },
      { label: 'Deleted', icon: 'trash', files: [{ path: 'src/lib/oldHelper.ts', action: 'deleted' }] },
    ],
  },
};

export const Many: Story = {
  args: {
    title: 'TypeScript files',
    files: Array.from({ length: 60 }, (_, i) => ({ path: `src/module-${Math.floor(i / 6)}/file-${i}.ts` })),
    total: 60,
    singularLabel: 'file',
    pluralLabel: 'files',
  },
};

export const Empty: Story = {
  args: { title: 'Matches', files: [], total: 0, singularLabel: 'match', pluralLabel: 'matches' },
};
