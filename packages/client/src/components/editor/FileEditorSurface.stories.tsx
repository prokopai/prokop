import type { ComponentType } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { FileEditorSurface } from './FileEditorSurface';
import { buildDocId, useFileEditorStore, type FileDocIdentity } from '@/stores/fileEditorStore';
import { createFakeSdkClient } from '../../../.storybook/harness';
import { createEditableFile } from '../../../.storybook/mocks/mockGit';

/**
 * The editor view: a strip of open documents and the active one in the Pierre
 * editor. Documents are opened in the store; content loads through the SDK.
 */

const SERVER = 'story-server';
const WORKSPACE = 'ws-1';

function identity(path: string): FileDocIdentity {
  return { serverId: SERVER, workspaceId: WORKSPACE, root: '', path };
}

/** Opens documents before the story renders; `after` can mutate the store once they exist. */
function withDocs(paths: string[], after?: (ids: string[]) => void) {
  return function DocsDecorator(Story: ComponentType) {
    const store = useFileEditorStore.getState();
    for (const id of store.openDocIds) store.closeDoc(id);
    const ids = paths.map((path) => store.openDoc(identity(path), path.split('/').pop() ?? path));
    after?.(ids);
    return <Story />;
  };
}

const meta = {
  title: 'Files & Git/FileEditorSurface',
  component: FileEditorSurface,
  parameters: {
    layout: 'fullscreen',
    smoke: 'skip: the Pierre code editor is a custom element; happy-dom has no layout',
  },
  args: { sdkClient: createFakeSdkClient(), serverId: SERVER, workspaceId: WORKSPACE },
  decorators: [(Story) => <div className="flex h-screen flex-col overflow-hidden bg-background"><Story /></div>],
} satisfies Meta<typeof FileEditorSurface>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoDocuments: Story = {
  decorators: [withDocs([])],
};

export const OneDocument: Story = {
  decorators: [withDocs(['src/auth/session.ts'])],
};

export const SeveralTabs: Story = {
  decorators: [withDocs(['src/auth/session.ts', 'src/auth/refresh.ts', 'README.md', 'package.json'])],
};

export const DirtyDocument: Story = {
  decorators: [withDocs(['src/auth/session.ts'], ([id]) => {
    const store = useFileEditorStore.getState();
    store.hydrateSuccess(id!, createEditableFile({ path: 'src/auth/session.ts' }));
    store.updateContent(id!, `${createEditableFile().content}\n// unsaved edit\n`);
  })],
};

export const Markdown: Story = {
  decorators: [withDocs(['docs/auth.md'], ([id]) => {
    useFileEditorStore.getState().hydrateSuccess(id!, createEditableFile({ path: 'docs/auth.md', name: 'auth.md', extension: 'md', language: 'markdown', content: '# Auth\n\nTokens are verified in `session.ts`.\n' }));
  })],
};

export const Loading: Story = {
  args: { sdkClient: createFakeSdkClient({ latencyMs: 60_000 }) },
  decorators: [withDocs(['src/auth/session.ts'])],
};

export const LoadFailed: Story = {
  args: { sdkClient: createFakeSdkClient({ http: { files: { readEditable: async () => { throw new Error('ENOENT: no such file'); } } } }) },
  decorators: [withDocs(['src/missing.ts'])],
};

export const RevisionConflict: Story = {
  decorators: [withDocs(['src/auth/session.ts'], ([id]) => {
    const store = useFileEditorStore.getState();
    const file = createEditableFile({ path: 'src/auth/session.ts' });
    store.hydrateSuccess(id!, file);
    store.updateContent(id!, `${file.content}\n// my edit\n`);
    store.setConflict(id!, { path: file.path, expectedRevision: 'rev-1', actualRevision: 'rev-2', currentContent: `${file.content}\n// someone else's edit\n` });
  })],
};

export const SingleDocumentHost: Story = {
  decorators: [withDocs(['src/auth/session.ts'])],
  render: (args) => <FileEditorSurface {...args} documentId={buildDocId(identity('src/auth/session.ts'))} documentContext="session.ts" />,
};
