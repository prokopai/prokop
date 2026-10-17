import { expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CommitFileDiff } from '@/components/files/CommitPatch';
import { commitFiles, parseCommitPatch } from '@/components/files/commitFiles';

const filePatch = (name: string) => `diff --git a/${name} b/${name}
index 1111111..2222222 100644
--- a/${name}
+++ b/${name}
@@ -1 +1 @@
-old
+new
`;

test('renders one file of a multi-file commit with the real Pierre renderer', () => {
  const files = commitFiles(['a.txt', 'b.txt'], parseCommitPatch(filePatch('a.txt') + filePatch('b.txt')).files);
  const { container } = render(<CommitFileDiff file={files[1]} themeType="light" />);
  expect(container.querySelectorAll('diffs-container')).toHaveLength(1);
});

test('files without a text diff explain the empty body', () => {
  const [file] = commitFiles(['logo.png'], []);
  const { container } = render(<CommitFileDiff file={file} themeType="dark" />);
  expect(container.querySelectorAll('diffs-container')).toHaveLength(0);
  expect(screen.getByText('No text diff for this file.')).toBeInTheDocument();
});
