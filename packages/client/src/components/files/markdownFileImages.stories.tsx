import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ProkopaiClient } from '@prokopai/sdk';
import { useMarkdownFileImages } from './markdownFileImages';
import { MarkdownRenderer } from '@/components/shared/MarkdownRenderer';
import { createFakeSdkClient } from '../../../.storybook/harness';
import { filePreviewPresets } from '../../../.storybook/mocks/mockGit';

/**
 * Relative images in a markdown file load through the preview API as data
 * URLs. Missing or non-image targets show their alt text in italics.
 */

const markdown = `# Authentication

A relative image: ![Logo](images/logo.svg)

A root-relative image: ![Logo again](/docs/images/logo.svg)

A missing image: ![Diagram](images/missing.png)

An external image: ![Placeholder](https://placehold.co/120x40)
`;

function Demo({ sdkClient, path }: { sdkClient: ProkopaiClient | null; path: string }) {
  const overrides = useMarkdownFileImages({ sdkClient, workspaceId: 'ws-1', path });
  return (
    <div className="max-w-2xl select-text text-sm">
      <MarkdownRenderer overrides={overrides}>{markdown}</MarkdownRenderer>
    </div>
  );
}

interface Args { sdkClient: ProkopaiClient | null; path: string }

const meta = {
  title: 'Files & Git/MarkdownFileImages',
  parameters: { layout: 'padded' },
  args: { sdkClient: createFakeSdkClient(), path: filePreviewPresets.markdown.path },
  render: (args) => <Demo {...args} />,
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<Args>;

export const Default: Story = {};

export const Loading: Story = {
  args: { sdkClient: createFakeSdkClient({ latencyMs: 60_000 }) },
};

export const Offline: Story = {
  args: { sdkClient: null },
};
