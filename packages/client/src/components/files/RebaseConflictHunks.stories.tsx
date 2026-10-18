import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { RebaseConflictHunks } from './RebaseConflictHunks';
import { conflictedText } from '../../../.storybook/mocks/mockGit';

/**
 * Conflict-by-conflict resolution: pick the incoming side, your side, or edit
 * the merged text. Resolved hunks stay visible so choices can be reversed.
 */

const twoConflicts = `${conflictedText}
export function refresh(token: string) {
<<<<<<< HEAD
  return rotate(token, { ttl: 3600 });
=======
  return rotate(token, { ttl: 7200, audit: true });
>>>>>>> feature: longer refresh ttl
}
`;

interface Args { draft: string; disabled: boolean; fileName: string; onChange: (text: string) => void }

function Harness({ draft, disabled, fileName, onChange }: Args) {
  const [text, setText] = useState(draft);
  return (
    <div className="flex h-screen flex-col gap-3 overflow-auto bg-background p-3">
      <RebaseConflictHunks draft={draft} disabled={disabled} fileName={fileName} onChange={(next) => { setText(next); onChange(next); }} incomingLabel="Incoming version · main" featureLabel="Your change · feature/login" />
      <details className="text-xs text-muted-foreground">
        <summary>Resolved text</summary>
        <pre className="mt-1 whitespace-pre-wrap rounded bg-muted p-2 font-mono text-2xs">{text}</pre>
      </details>
    </div>
  );
}

const meta = {
  title: 'Files & Git/RebaseConflictHunks',
  parameters: {
    layout: 'fullscreen',
    smoke: 'skip: the merge editor is a Pierre custom element; happy-dom has no layout',
  },
  args: { draft: conflictedText, disabled: false, fileName: 'session.ts', onChange: fn() },
  render: (args) => <Harness {...args} />,
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<Args>;

export const OneConflict: Story = {};

export const TwoConflicts: Story = {
  args: { draft: twoConflicts },
};

export const Disabled: Story = {
  args: { disabled: true },
};
