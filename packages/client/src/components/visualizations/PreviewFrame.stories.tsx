import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { CopyIcon, ExternalLinkIcon } from 'lucide-react';
import { PreviewAction, PreviewCornerButton, PreviewFrame } from './PreviewFrame';

/**
 * The shell every tool preview sits in: optional caption, hover corner,
 * fold gradient and the show-all toggle.
 */

function Lines({ count }: { count: number }) {
  return (
    <pre className="px-3 py-2 font-mono text-xs leading-5">
      {Array.from({ length: count }, (_, i) => `line ${i + 1}`).join('\n')}
    </pre>
  );
}

function Stateful(props: Omit<React.ComponentProps<typeof PreviewFrame>, 'expanded' | 'onToggle' | 'children'> & { lines: number; onToggle: (expanded: boolean) => void }) {
  const [expanded, setExpanded] = useState(false);
  const { lines, onToggle, ...rest } = props;
  return (
    <PreviewFrame {...rest} expanded={expanded} onToggle={(next) => { setExpanded(next); onToggle(next); }}>
      <div className={expanded ? undefined : 'max-h-40 overflow-hidden'}>
        <Lines count={lines} />
      </div>
    </PreviewFrame>
  );
}

interface Args { onToggle: (expanded: boolean) => void }

const meta = {
  title: 'Visualizations/PreviewFrame',
  parameters: { layout: 'padded' },
  args: { onToggle: fn() },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<Args>;

export const Short: Story = {
  render: ({ onToggle }) => <Stateful totalLines={4} budget={8} lines={4} onToggle={onToggle} />,
};

export const Folded: Story = {
  render: ({ onToggle }) => <Stateful totalLines={40} budget={8} lines={40} onToggle={onToggle} />,
};

export const WithCaptionAndCorner: Story = {
  render: ({ onToggle }) => (
    <Stateful
      totalLines={40}
      budget={8}
      lines={40}
      onToggle={onToggle}
      caption={<span className="truncate">src/components/visualizations/PreviewFrame.tsx</span>}
      corner={(
        <>
          <PreviewCornerButton onClick={fn()} label="Copy"><CopyIcon className="size-3.5" /></PreviewCornerButton>
          <PreviewCornerButton onClick={fn()} label="Open"><ExternalLinkIcon className="size-3.5" /></PreviewCornerButton>
        </>
      )}
      actions={<PreviewAction onClick={fn()}>Open in editor</PreviewAction>}
    />
  ),
};
