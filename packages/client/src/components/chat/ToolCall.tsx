import { memo, useEffect, useState, useMemo } from 'react';
import { ChevronRight, ExternalLink, Copy, Check, Loader2 } from 'lucide-react';
import type { ToolPart } from '@prokopai/sdk';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { VisualizationRenderer } from '@/components/visualizations';
import { RENDER_BUDGETS } from '@/lib/renderBudgets';
import { getToolPartVisualization, getToolRowInfo, isAnswerVisualization, showToolRawData, toolChipToneClass } from '@/lib/toolSummaries';
import { firstLine, formatDuration, formatElapsed, getInterruptReasonLabel, getToolDurationMs } from '@/lib/turnStats';
import { useSdkClient, useServerUrl } from '@/contexts/ServerClientContext';
import { useToolDebugQuery, useToolDisplayCatalog } from '@/hooks/queries';
import { cn } from '@/lib/utils';
import { useVizExpanded } from '@/lib/vizExpansion';

interface LazyOutputProps {
  content: string;
  className?: string;
}

const LazyOutput = memo(function LazyOutput({ content, className }: LazyOutputProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const size = content.length;
  const isLarge = size > RENDER_BUDGETS.toolOutputPreviewChars;
  const preview = isLarge ? content.slice(0, RENDER_BUDGETS.toolOutputPreviewChars) + '\n...' : null;

  if (!isLarge) {
    return <pre className={className}>{content}</pre>;
  }

  const sizeLabel = size > 1024 * 1024
    ? `${(size / (1024 * 1024)).toFixed(1)} MB`
    : size > 1024
      ? `${(size / 1024).toFixed(1)} KB`
      : `${size} bytes`;

  return (
    <div>
      <pre className={className}>{isExpanded ? content : preview}</pre>
      <button
        type="button"
        className="text-xs text-muted-foreground hover:text-foreground mt-1 transition-colors"
        onClick={() => setIsExpanded(prev => !prev)}
      >
        {isExpanded ? 'Show less' : `Show full output (${sizeLabel})`}
      </button>
    </div>
  );
});

interface ToolCallProps {
  collapsePreview?: boolean;
  sessionId: string;
  part: ToolPart;
  onNavigateToSubagent?: (sessionId: string) => void;
}

/** Section heading inside an expanded tool row: sentence case, same gray as the meta text. */
function SectionLabel({ children }: { children: string }) {
  return <div className="mb-1 text-2xs font-medium text-muted-foreground/70">{children}</div>;
}

function extractTaskSessionId(part: ToolPart): string | null {
  if (part.name !== 'task' && part.name !== 'subagent') return null;
  const state = part.state;
  if ('childSessionId' in state && state.childSessionId) {
    return state.childSessionId as string;
  }
  const output = 'output' in state
    ? state.output
    : 'partialOutput' in state
      ? state.partialOutput
      : null;
  if (output && typeof output === 'string') {
    const match = output.match(/task_id:\s*([a-f0-9-]{36})/i);
    if (match) return match[1];
  }
  return null;
}

/** Ticks once per second; mounted only while a tool runs. */
function ElapsedTime({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <span className="shrink-0 font-mono text-2xs tabular-nums text-muted-foreground/70">
      {formatElapsed(now - startedAt)}
    </span>
  );
}

const areToolCallPropsEqual = (
  prev: ToolCallProps,
  next: ToolCallProps
): boolean => {
  if (prev.sessionId !== next.sessionId) return false;
  if (prev.collapsePreview !== next.collapsePreview) return false;
  if (prev.part !== next.part) return false;
  if (prev.onNavigateToSubagent !== next.onNavigateToSubagent) return false;

  return true;
};

export const ToolCall = memo(function ToolCall({
  collapsePreview = false,
  sessionId,
  part,
  onNavigateToSubagent,
}: ToolCallProps) {
  const serverUrl = useServerUrl();
  const [isOpen, setIsOpen] = useVizExpanded(`tool:${serverUrl}:${sessionId}:${part.id}`, false);
  const [copied, setCopied] = useState(false);
  const [debugExpanded, setDebugExpanded] = useState(false);

  const state = part.state;
  const status = state.status;
  const visualization = getToolPartVisualization(part);
  // Pages and images are part of the answer, so older turns keep them visible.
  const previewCollapsed = collapsePreview && !isAnswerVisualization(visualization);
  const durationMs = getToolDurationMs(state);
  const interruptReason = getInterruptReasonLabel(state);
  const errorLine = state.status === 'error' && typeof state.error === 'string' ? firstLine(state.error) : '';
  const debugOpen = showToolRawData(isOpen, visualization, debugExpanded);
  const sdkClient = useSdkClient();
  const shouldLoadDebug = part.presentation?.debugAvailable === true;
  const debugQuery = useToolDebugQuery(
    sdkClient,
    sessionId,
    part.id,
    debugOpen && shouldLoadDebug,
  );
  const rawInput = shouldLoadDebug ? debugQuery.data?.input : state.input;
  const rawOutput = shouldLoadDebug
    ? debugQuery.data?.output
    : status === 'completed' && 'output' in state
      ? state.output
      : undefined;
  const debugReady = !shouldLoadDebug || debugQuery.data !== undefined;

  const serializedInput = useMemo((): string => {
    if (!debugOpen || rawInput === undefined) return '';
    try {
      return JSON.stringify(rawInput, null, 2);
    } catch {
      return String(rawInput);
    }
  }, [rawInput, debugOpen]);

  const serializedOutput = useMemo((): string | null => {
    if (!debugOpen || rawOutput === undefined) return null;
    return typeof rawOutput === 'string'
      ? rawOutput
      : JSON.stringify(rawOutput, null, 2);
  }, [rawOutput, debugOpen]);

  const taskSessionId = extractTaskSessionId(part);

  const catalog = useToolDisplayCatalog(sdkClient);

  const { summary, chips } = useMemo(() => getToolRowInfo(part, catalog), [part, catalog]);

  const handleCopyOutput = async () => {
    if (rawOutput !== undefined) {
      const output = typeof rawOutput === 'string'
        ? rawOutput
        : JSON.stringify(rawOutput, null, 2);
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="my-1">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <div
            className={cn(
              'group/tool-row flex items-center gap-2 py-1 text-xs transition-colors',
              status === 'error'
                ? 'text-destructive'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {/* Success is silent: only a running call spins. The chevron is the one disclosure glyph. */}
            {status === 'running' || status === 'pending' ? (
              <Loader2 className="size-3 shrink-0 animate-spin" />
            ) : (
              <ChevronRight className={cn('size-3 shrink-0 opacity-60 transition-transform', isOpen && 'rotate-90')} />
            )}

            <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
              <span className="truncate shrink-0 max-w-[90px] sm:max-w-none">{part.name}</span>

              {summary && (
                <span className={cn('font-mono truncate min-w-0 flex-1', status !== 'error' && 'text-muted-foreground/70')}>
                  {summary}
                </span>
              )}
            </span>

            {chips.map((chip) => (
              <span
                key={chip.label}
                className={`text-2xs font-mono tabular-nums shrink-0 hidden sm:inline ${toolChipToneClass[chip.tone]}`}
              >
                {chip.label}
              </span>
            ))}

            {interruptReason && (
              <span className={`text-2xs font-mono shrink-0 ${toolChipToneClass.neutral}`}>
                {interruptReason}
              </span>
            )}

            {state.status === 'running' && <ElapsedTime startedAt={state.startedAt} />}

            {durationMs !== undefined && (
              <span className="hidden shrink-0 font-mono text-2xs tabular-nums text-muted-foreground/70 sm:inline">
                {formatDuration(durationMs)}
              </span>
            )}

            {taskSessionId && onNavigateToSubagent && (
              <Button
                variant="ghost"
                size="icon-xs"
                className={cn(
                  'ml-auto shrink-0',
                  'opacity-0 transition-opacity group-hover/tool-row:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100',
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  onNavigateToSubagent(taskSessionId!);
                }}
                title="View session"
                aria-label="View session"
              >
                <ExternalLink className="size-3" />
              </Button>
            )}
          </div>
        </CollapsibleTrigger>

        {!isOpen && errorLine && (
          <div className="truncate pl-5 text-xs text-destructive/90" title={errorLine}>
            {errorLine}
          </div>
        )}

        {isOpen && <CollapsibleContent>
          <div className="pl-5 pb-2 flex flex-col gap-2">
            {visualization?.type === 'none' && visualization.message && (
              <div className="text-xs text-muted-foreground">{visualization.message}</div>
            )}
            {/* Pretty body for collapsed visualizations (chip-only while collapsed) */}
            {visualization && (visualization.collapsed || previewCollapsed) && visualization.type !== 'none' && (
              <div>
                <SectionLabel>Result</SectionLabel>
                <VisualizationRenderer visualization={visualization} persistKey={part.id} />
              </div>
            )}

            {visualization && (
              <Button
                variant="link"
                size="xs"
                className="h-auto self-start p-0 text-muted-foreground hover:text-foreground"
                aria-expanded={debugExpanded}
                onClick={() => setDebugExpanded(value => !value)}
              >
                {debugExpanded ? 'Hide raw data' : 'Show raw data'}
              </Button>
            )}

            {debugOpen && shouldLoadDebug && debugQuery.isFetching && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <Loader2 className="size-3 animate-spin" />
                Loading raw data...
              </div>
            )}

            {debugOpen && shouldLoadDebug && debugQuery.isError && (
              <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-2 text-xs text-destructive">
                <span>Raw data could not be loaded.</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6"
                  onClick={() => void debugQuery.refetch()}
                >
                  Retry
                </Button>
              </div>
            )}

            {debugOpen && debugReady && (
              <div>
                <SectionLabel>Input</SectionLabel>
                <LazyOutput
                  content={serializedInput}
                  className="text-xs bg-background border rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-words"
                />
              </div>
            )}

            {/* Subagent Navigation */}
            {(status === 'running' || status === 'completed' || status === 'interrupted' || status === 'error')
              && taskSessionId && onNavigateToSubagent && (
              <Button
                variant="outline"
                className="w-full"
                size="sm"
                onClick={() => onNavigateToSubagent(taskSessionId!)}
              >
                <ExternalLink className="size-4" data-icon="inline-start" />
                {status === 'running' ? 'Watch Subagent' : 'View Session'}
              </Button>
            )}

            {/* Output - raw debug JSON */}
            {debugOpen && debugReady && status === 'completed' && serializedOutput !== null && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <SectionLabel>Output</SectionLabel>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleCopyOutput}
                    className="size-6"
                  >
                    {copied ? (
                      <Check className="size-3 text-success" />
                    ) : (
                      <Copy className="size-3" />
                    )}
                  </Button>
                </div>
                <LazyOutput
                  content={serializedOutput}
                  className="text-xs bg-muted/50 border border-border/50 rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-words"
                />
              </div>
            )}

            {/* Error */}
            {status === 'error' && 'error' in state && (
              <div>
                <SectionLabel>Error</SectionLabel>
                <pre className="text-xs bg-destructive/10 border border-destructive/20 rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-words text-destructive">
                  {state.error as string}
                </pre>
              </div>
            )}
          </div>
        </CollapsibleContent>}
      </Collapsible>

      {/* Older previews mount inside the existing expandable row, not hidden DOM. */}
      {status === 'completed' && visualization && !visualization.collapsed && !previewCollapsed && visualization.type !== 'none' && (
        <div className="mt-1">
          <VisualizationRenderer visualization={visualization} persistKey={part.id} />
        </div>
      )}
    </div>
  );
}, areToolCallPropsEqual);
