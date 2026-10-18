import { useCallback, useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { RENDER_BUDGETS } from '@/lib/renderBudgets';
import { useVizExpanded } from '@/lib/vizExpansion';
import { cn } from '@/lib/utils';
import { PreviewAction, PreviewFrame } from './PreviewFrame';

interface TerminalOutputProps {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  /** Absent means the command completed. */
  status?: 'running' | 'killed';
  /** Stable identity (tool-call part id) for persisted expansion state. */
  vizKey?: string;
}

interface OutputLine {
  text: string;
  stream: 'out' | 'err';
}

function splitLines(text: string | undefined, stream: OutputLine['stream']): OutputLine[] {
  const trimmed = text?.replace(/\s+$/, '') ?? '';
  if (!trimmed) return [];
  return trimmed.split('\n').map((line) => ({ text: line, stream }));
}

/**
 * Command output as a peek. The command and its exit code live on the tool
 * row, so the body is output only. Folded, it shows the last lines, because
 * that is where a result or a failure sits; stderr takes color only when the
 * command failed.
 */
export function TerminalOutput({ stdout, stderr, exitCode, status, vizKey }: TerminalOutputProps) {
  const lines = useMemo(() => [...splitLines(stdout, 'out'), ...splitLines(stderr, 'err')], [stdout, stderr]);
  const [expanded, setExpanded] = useVizExpanded(
    vizKey ? `shell:${vizKey}` : `shell:${stdout?.length ?? 0}:${stderr?.length ?? 0}`,
    false,
  );
  const [copied, setCopied] = useState(false);

  const failed = status === 'killed' || (exitCode ?? 0) !== 0;
  const budget = RENDER_BUDGETS.shellPreviewLines;
  const hidden = expanded ? 0 : Math.max(0, lines.length - budget);
  const visible = hidden > 0 ? lines.slice(hidden) : lines;

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(lines.map((line) => line.text).join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [lines]);

  if (lines.length === 0) return null;

  return (
    <PreviewFrame
      totalLines={lines.length}
      budget={budget}
      expanded={expanded}
      onToggle={setExpanded}
      actions={(
        <PreviewAction onClick={handleCopy} title="Copy output">
          <span className="flex items-center gap-1">
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            Copy
          </span>
        </PreviewAction>
      )}
    >
      <pre className="m-0 overflow-x-auto whitespace-pre-wrap px-3 py-2 font-mono text-xs leading-relaxed text-foreground/85">
        {hidden > 0 && (
          <span className="block select-none text-muted-foreground/70">… {hidden} earlier {hidden === 1 ? 'line' : 'lines'}</span>
        )}
        {visible.map((line, index) => (
          <span
            key={index}
            data-stream={line.stream}
            className={cn('block min-h-[1lh]', line.stream === 'err' && (failed ? 'text-error' : 'text-muted-foreground'))}
          >
            {line.text}
          </span>
        ))}
      </pre>
    </PreviewFrame>
  );
}
