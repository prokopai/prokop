import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

vi.mock('@/components/providers/ThemeProvider', () => ({ useTheme: () => ({ resolvedMode: 'dark' }) }));

import { MarkdownRenderer } from '@/components/shared/MarkdownRenderer';
import { MarkdownFileLinkContext } from '@/components/shared/markdownFileLinks';

const REPLY = '[release-notes.xlsx](.claude/skills/out/release-notes.xlsx) and [docs](https://example.com/docs)';

describe('MarkdownRenderer file links', () => {
  test('a file link opens the file preview instead of a new tab', async () => {
    const openFile = vi.fn();
    render(<MarkdownFileLinkContext.Provider value={openFile}><MarkdownRenderer>{REPLY}</MarkdownRenderer></MarkdownFileLinkContext.Provider>);

    const file = screen.getByRole('link', { name: 'release-notes.xlsx' });
    expect(file).not.toHaveAttribute('target');
    expect(file).toHaveAttribute('title', '.claude/skills/out/release-notes.xlsx');
    await userEvent.click(file);
    expect(openFile).toHaveBeenCalledWith('.claude/skills/out/release-notes.xlsx');

    expect(screen.getByRole('link', { name: 'docs' })).toHaveAttribute('target', '_blank');
  });

  test('without a session, file links stay plain links', () => {
    render(<MarkdownRenderer>{REPLY}</MarkdownRenderer>);
    expect(screen.getByRole('link', { name: 'release-notes.xlsx' })).toHaveAttribute('target', '_blank');
  });
});
