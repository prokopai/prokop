import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Archive, ChevronRight, Minimize2, Loader2, AlertTriangle } from 'lucide-react';
import type { Session, Preconfig, ProkopaiClient } from '@prokopai/sdk';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TokenMeter } from './TokenMeter';
import { SessionModelChips } from './SessionModelChips';
import { useSessionControlStore } from '@/stores/sessionControlStore';
import { usePendingOperationsStore } from '@/stores/pendingOperationsStore';
import type { SessionUsage } from '@/stores/sessionContentStore';

import { useClientIdentityStore } from '@/stores/clientIdentityStore';

interface Model {
  id: string;
  name: string;
  contextWindow: number;
  providerId: string;
  providerName: string;
}

interface ChatHeaderProps {
  session: Session;
  sdkClient?: ProkopaiClient | null;
  preconfigs: Preconfig[];
  models: Model[];
  usage: SessionUsage;
  modelName: string;
  onRename: (sessionId: string, title: string) => void;
  onNavigateBack?: () => void;
  isStreaming?: boolean;
  onCompact?: () => void;
  isCompacting?: boolean;
  canCompact?: boolean;
  /** Shown before the title where sessions from several workspaces mix (Overview). */
  workspaceLabel?: string | null;
}

/**
 * Title and token meter at the left; agent, model and compact at the right.
 * Checkout, permissions and format sit under the composer: the header holds
 * what the session is, the composer what each message runs with.
 */
export function ChatHeader({
  session,
  sdkClient = null,
  preconfigs,
  models,
  modelName,
  onRename,
  onNavigateBack,
  isStreaming,
  onCompact,
  isCompacting,
  canCompact,
  workspaceLabel,
}: ChatHeaderProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(session.title || '');
  const inputRef = useRef<HTMLInputElement>(null);
  const codexSession = session.harness === 'codex-cli';
  const claudeSession = session.harness === 'claude-cli';

  const controlState = useSessionControlStore((s) => s.controlBySessionId[session.id]);
  const myClientId = useClientIdentityStore((s) => s.clientId);

  const isObserver = controlState?.status === 'controlled' && controlState.controllerClientId !== myClientId;
  const compactPending = usePendingOperationsStore(s => s.operations.some(op =>
    op.sessionId === session.id && op.type === 'compact'));
  const compactUncertain = claudeSession && session.metadata?.claudeCompactPending === true
    && !compactPending && !isCompacting;
  const compactBusy = isCompacting || compactPending
    || (codexSession && session.metadata?.codexCompactPending === true);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleTitleDoubleClick = () => {
    setEditTitle(session.title || '');
    setIsEditing(true);
  };

  const handleTitleSubmit = () => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== session.title) {
      onRename(session.id, trimmed);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleTitleSubmit();
    } else if (e.key === 'Escape') {
      setEditTitle(session.title || '');
      setIsEditing(false);
    }
  };

  const selectedModel = session.selectedModel ||
    preconfigs.find((p) => p.id === session.preconfigId)?.model ||
    modelName;

  const currentModelInfo = session.selectedProvider
    ? models.find((m) => m.providerId === session.selectedProvider && m.id === selectedModel)
    : models.find((m) => m.id === selectedModel);
  const modelContextWindow = currentModelInfo?.contextWindow ?? 0;
  // Prokop sessions carry no server-side context window (the server does not
  // know model limits); fill the meter denominator from the model catalog so
  // the ring keeps its percentage. Codex and Claude report theirs.
  const reportedUsage = session.harnessState?.usage ?? null;
  const meterUsage = reportedUsage
    ? {
      ...reportedUsage,
      contextWindow: reportedUsage.contextWindow > 0 ? reportedUsage.contextWindow : modelContextWindow,
    }
    : null;

  return (
    <div className="@container/chips flex-1 min-w-0 flex items-center justify-between gap-1">
      <div className="flex items-center justify-between gap-1 w-full min-w-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {session.parentId && onNavigateBack && (
              <Button
                variant="ghost"
                onClick={onNavigateBack}
                className="h-7"
              >
                <ArrowLeft className="size-4" data-icon="inline-start" />
                Back
              </Button>
            )}

            {workspaceLabel && !isEditing && (
              <span className="flex min-w-0 shrink items-center gap-1 text-sm text-muted-foreground" title={`Workspace: ${workspaceLabel}`}>
                <span className="max-w-[10rem] truncate">{workspaceLabel}</span>
                <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground/60" />
              </span>
            )}

            {isEditing ? (
              <input
                ref={inputRef}
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={handleTitleSubmit}
                onKeyDown={handleKeyDown}
                className="text-base font-semibold leading-none bg-background border border-ring rounded-md px-2 py-1.5 outline-none min-w-0 flex-1"
                autoFocus
              />
            ) : (
              <h2
                className="text-base font-semibold leading-none px-2 py-1.5 -mx-2 rounded-md hover:bg-accent transition-colors truncate min-w-0"
                onDoubleClick={handleTitleDoubleClick}
              >
                {session.title || 'Untitled Session'}
              </h2>
            )}

            <TokenMeter usage={meterUsage} />
            {session.status === 'closed' && (
              <Badge variant="secondary">
                <Archive className="size-3" data-icon="inline-start" />
                Archived
              </Badge>
            )}
          </div>

          <div className="flex min-w-0 shrink-0 items-center gap-1.5">
            <SessionModelChips session={session} sdkClient={sdkClient} disabled={isObserver} />
            {onCompact && !isObserver && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onCompact}
                disabled={isStreaming || compactBusy || compactUncertain || !canCompact}
                aria-label={compactUncertain ? 'Compaction outcome unknown' : 'Compact older messages'}
                title={compactUncertain ? 'Compaction outcome unknown. This session is locked to avoid replay.'
                  : compactBusy ? 'Compacting...' : 'Compact older messages'}
              >
                {compactUncertain ? <AlertTriangle className="size-4 text-warning" />
                  : compactBusy ? <Loader2 className="size-4 animate-spin" />
                    : <Minimize2 className="size-4" />}
              </Button>
            )}

          </div>
      </div>
    </div>
  );
}
