import type { ThemeTypes } from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';
import { PIERRE_THEME_PAIR } from '@/lib/pierreDiffsTheme';
import type { CommitFile } from './commitFiles';

/** One changed file of a commit; the caller picks which file is shown. */
export function CommitFileDiff({ file, themeType }: { file: CommitFile; themeType: ThemeTypes }) {
  if (!file.diff) return <p className="p-3 text-xs text-muted-foreground">No text diff for this file.</p>;
  return <FileDiff fileDiff={file.diff} options={{ diffStyle: 'unified', theme: PIERRE_THEME_PAIR, themeType, stickyHeader: true }} />;
}
