import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { TerminalOutput } from '@/components/visualizations/TerminalOutput';

function lines(count: number, prefix = 'line'): string {
  return Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`).join('\n');
}

describe('TerminalOutput', () => {
  it('renders stdout as output lines', () => {
    render(<TerminalOutput exitCode={0} stdout="hello" />);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('shows no command header: the tool row carries command and exit code', () => {
    render(<TerminalOutput exitCode={1} stdout="out" />);
    expect(screen.queryByText('$')).not.toBeInTheDocument();
    expect(screen.queryByText(/\[1\]|exit 1/)).not.toBeInTheDocument();
  });

  it('colors stderr only when the command failed', () => {
    const { unmount } = render(<TerminalOutput exitCode={1} stderr="error occurred" />);
    expect(screen.getByText('error occurred').className).toContain('text-destructive');
    unmount();

    render(<TerminalOutput exitCode={0} stderr="warning only" />);
    const warning = screen.getByText('warning only');
    expect(warning.className).not.toContain('text-destructive');
    expect(warning.className).toContain('text-muted-foreground');
  });

  it('treats a killed command as failed', () => {
    render(<TerminalOutput status="killed" stderr="stopped" />);
    expect(screen.getByText('stopped').className).toContain('text-destructive');
  });

  it('renders stdout before stderr', () => {
    render(<TerminalOutput exitCode={1} stdout="output" stderr="error" />);
    const out = screen.getByText('output');
    const err = screen.getByText('error');
    expect(out.compareDocumentPosition(err) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders nothing for empty or whitespace-only output', () => {
    const { container, unmount } = render(<TerminalOutput exitCode={0} />);
    expect(container.firstChild).toBeNull();
    unmount();
    const second = render(<TerminalOutput stdout="   " />);
    expect(second.container.firstChild).toBeNull();
  });

  it('folds long output to its last lines with a count of the earlier ones', () => {
    render(<TerminalOutput exitCode={0} stdout={lines(40)} vizKey="fold" />);
    expect(screen.getByText('… 28 earlier lines')).toBeInTheDocument();
    expect(screen.queryByText('line 28')).not.toBeInTheDocument();
    expect(screen.getByText('line 29')).toBeInTheDocument();
    expect(screen.getByText('line 40')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show all 40 lines' })).toBeInTheDocument();
  });

  it('shows everything inline after Show all, with no nested scroller', async () => {
    const { container } = render(<TerminalOutput exitCode={0} stdout={lines(40)} vizKey="show-all" />);
    await userEvent.click(screen.getByRole('button', { name: 'Show all 40 lines' }));
    expect(screen.getByText('line 1')).toBeInTheDocument();
    expect(screen.queryByText(/earlier lines/)).not.toBeInTheDocument();
    expect(container.querySelector('.tool-output-scroll')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument();
  });

  it('does not offer Show all when the output fits the budget', () => {
    render(<TerminalOutput exitCode={0} stdout={lines(5)} />);
    expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument();
  });

  it('uses a monospace output body', () => {
    const { container } = render(<TerminalOutput exitCode={0} stdout="mono" />);
    expect(container.querySelector('pre')?.className).toContain('font-mono');
  });
});
