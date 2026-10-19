import { Input } from '@/components/ui/input';
import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import type { ContextReference, ProkopaiClient, Session } from '@prokopai/sdk';
import { ArrowUp, Square, Paperclip, AlertTriangle, Target, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FileEntry, PromptInfo, AttachmentKind } from '@prokopai/sdk';
import { FileAutocomplete } from '@/components/files/FileAutocomplete';
import { PromptAutocomplete } from '@/components/chat/PromptAutocomplete';
import { PendingAttachment } from './PendingAttachment';
import { ComposerEditor, type ComposerEditorHandle, type ComposerTrigger } from './ComposerEditor';
import { AutoApproveSelector } from './AutoApproveSelector';
import { ResponseFormatSelector } from './ResponseFormatSelector';
import { SessionCheckoutSelector, SessionCheckoutStrip } from '@/components/worktrees/SessionCheckoutSelector';
import { useResponseFormatsQuery } from '@/hooks/queries';
import { sessionReferenceRoot, useContextFileOpener } from '@/hooks/useContextFileOpener';
import { useSessionDraft } from '@/hooks/useSessionDraft';
import { registerComposer } from '@/lib/composerTargets';
import { Popover, PopoverContent, PopoverAnchor } from '@/components/ui/popover';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { randomUUID } from '@/lib/randomId';
import { useUIStore } from '@/stores/uiStore';

interface MessageInputProps {
  onSendMessage: (content: string, attachments?: Array<{ id: string; kind: AttachmentKind }>, responseFormatId?: string, goal?: { condition: string; maxTurns?: number; tokenBudget?: number }) => void;
  disabled?: boolean;
  isStreaming?: boolean;
  onStopStreaming?: () => void;
  placeholder?: string;
  workspaceId?: string;
  sdkClient?: ProkopaiClient | null;
  prompts?: PromptInfo[];
  sessionId?: string;
  session?: Session | null;
  /** Checkout is locked once the session has messages. */
  checkoutLocked?: boolean;
  modelSupportsImage?: boolean;
  /** Present while a queued message can still be steered; Enter in an empty box calls it. */
  onSteerQueued?: () => void;
}

interface PendingAttachmentData {
  id: string;
  kind: AttachmentKind;
  filename: string;
  size: number;
  previewUrl?: string;
  uploadedId?: string;
  uploadedKind?: AttachmentKind;
  isUploading?: boolean;
}

export interface MessageInputHandle {
  focus: () => void;
  /** Puts an unsent prompt back into the input for editing. */
  restoreText: (text: string) => void;
}

function expandPromptContent(prompt: PromptInfo, userText: string): string {
  if (userText) {
    if (prompt.content.includes('ARG')) {
      return prompt.content.replace('ARG', userText);
    }
    return `${prompt.content}\n${userText}`;
  }
  return prompt.content;
}

function extractPromptCommand(input: string): { command: string; rest: string } | null {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith('/')) return null;
  const spaceIndex = trimmed.indexOf(' ');
  if (spaceIndex === -1) {
    return { command: trimmed.slice(1), rest: '' };
  }
  return { command: trimmed.slice(1, spaceIndex), rest: trimmed.slice(spaceIndex + 1).trim() };
}

export const MessageInput = forwardRef<MessageInputHandle, MessageInputProps>(function MessageInput({
  onSendMessage,
  disabled,
  isStreaming,
  onStopStreaming,
  placeholder = 'Type a message...',
  workspaceId,
  sdkClient,
  prompts = [],
  sessionId,
  session,
  checkoutLocked,
  modelSupportsImage,
  onSteerQueued,
}: MessageInputProps, ref) {
  const codexSession = session?.harness === 'codex-cli';
  const claudeSession = session?.harness === 'claude-cli';
  const { input, setInput, clearInput } = useSessionDraft(sessionId);
  const [trigger, setTrigger] = useState<ComposerTrigger | null>(null);
  const [dismissedTrigger, setDismissedTrigger] = useState<ComposerTrigger | null>(null);
  const [autocompleteFiles, setAutocompleteFiles] = useState<FileEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachmentData[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedResponseFormatId, setSelectedResponseFormatId] = useState<string | undefined>(undefined);
  const [selectedSendMode, setSendMode] = useState<'chat' | 'goal'>('chat');
  const sendMode = selectedSendMode;
  const [goalMaxTurns, setGoalMaxTurns] = useState(5);
  const [goalTokenBudget, setGoalTokenBudget] = useState(50_000);
  const editorRef = useRef<ComposerEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const followUpMode = useUIStore(s => s.followUpMode);
  const { data: responseFormatsData } = useResponseFormatsQuery(sdkClient ?? null);
  const responseFormats = responseFormatsData?.formats ?? [];

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.focus(),
    // A draft already in the input stays below the restored text.
    restoreText: (text: string) => {
      setInput(input.trim() ? `${text}\n\n${input}` : text);
      editorRef.current?.focus();
    },
  }), [input, setInput]);

  // Terminal "Add to chat" and other panels insert references into this session's composer.
  useEffect(() => {
    if (!sessionId) return;
    return registerComposer(sessionId, (reference) => editorRef.current?.insertReference(reference));
  }, [sessionId]);

  const openContextFile = useContextFileOpener(sessionId);
  const referenceRoot = sessionReferenceRoot(session);

  const handleTriggerChange = useCallback((next: ComposerTrigger | null) => {
    setTrigger(next);
    setSelectedIndex(0);
  }, []);

  const promptQuery = trigger?.kind === 'prompt' ? trigger.query : '';
  const filteredPrompts = prompts.filter(p =>
    p.name.toLowerCase().includes(promptQuery.toLowerCase())
  );

  const triggerOpen = !!trigger && trigger !== dismissedTrigger;
  const showPromptAc = triggerOpen && trigger.kind === 'prompt' && prompts.length > 0 && (!codexSession || sendMode === 'chat');
  const showFileAc = triggerOpen && trigger.kind === 'file' && !!workspaceId;

  const closeAutocomplete = useCallback(() => {
    setDismissedTrigger(trigger);
  }, [trigger]);

  const handleFileSelect = useCallback((file: FileEntry) => {
    if (!trigger) return;
    const reference: ContextReference = { kind: 'file', path: file.type === 'directory' ? `${file.path}/` : file.path };
    editorRef.current?.replaceTrigger(trigger, { reference });
    setAutocompleteFiles([]);
  }, [trigger]);

  const handlePromptSelect = useCallback((prompt: PromptInfo) => {
    if (!trigger) return;
    editorRef.current?.replaceTrigger(trigger, { text: `/${prompt.name}` });
  }, [trigger]);

  const cleanupPending = useCallback(() => {
    for (const a of pendingAttachments) {
      if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    }
    setPendingAttachments([]);
    clearInput();
  }, [pendingAttachments, clearInput]);

  const uploadAttachment = useCallback(async (file: File): Promise<PendingAttachmentData | null> => {
    if (!sdkClient || !sessionId) return null;

    try {
      const attachment = await sdkClient?.http.attachments.upload(sessionId, file);

      return {
        id: randomUUID(),
        kind: attachment.kind as AttachmentKind,
        filename: attachment.filename,
        size: attachment.size,
        uploadedId: attachment.id,
        uploadedKind: attachment.kind as AttachmentKind,
      };
    } catch (err) {
      console.error('Upload error:', err);
      return null;
    }
  }, [sdkClient, sessionId]);

  const removeAttachment = useCallback((id: string) => {
    setPendingAttachments(prev => {
      const item = prev.find(a => a.id === id);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return prev.filter(a => a.id !== id);
    });
  }, []);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files).filter(file => !(codexSession || claudeSession)
      || ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type));

    for (const file of fileArray) {
      if (file.size > 20 * 1024 * 1024) continue;

      const localKind = file.type.startsWith('image/') ? 'image' as const
        : file.type.startsWith('video/') ? 'video' as const
        : 'file' as const;

      const previewItem: PendingAttachmentData = {
        id: randomUUID(),
        kind: localKind,
        filename: file.name,
        size: file.size,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
        isUploading: true,
      };
      setPendingAttachments(prev => [...prev, previewItem]);

      const result = await uploadAttachment(file);
      if (result) {
        setPendingAttachments(prev => prev.map(a => {
          if (a.id === previewItem.id) {
            return { ...result, previewUrl: a.previewUrl, isUploading: false };
          }
          return a;
        }));
      } else {
        if (previewItem.previewUrl) URL.revokeObjectURL(previewItem.previewUrl);
        setPendingAttachments(prev => prev.filter(a => a.id !== previewItem.id));
      }
    }
  }, [uploadAttachment, codexSession, claudeSession]);

  const handlePasteFiles = useCallback((files: File[]) => {
    if (!files.some(file => !(codexSession || claudeSession)
      || ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type))) return false;
    void addFiles(files);
    return true;
  }, [addFiles, codexSession, claudeSession]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      addFiles(files);
    }
  }, [addFiles]);

  const goal = session?.harnessState?.goal ?? null;
  const goalActive = goal?.status === 'active';
  const budgetValid = Number.isSafeInteger(goalTokenBudget) && goalTokenBudget > 0 && goalTokenBudget <= 1_000_000;
  const effectiveDisabled = disabled || goalActive || ((codexSession || claudeSession) && sendMode === 'goal' && isStreaming);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = input.trim();
    if (!trimmed && pendingAttachments.length === 0) {
      if (onSteerQueued && !disabled && sendMode === 'chat') onSteerQueued();
      return;
    }
    if (effectiveDisabled || pendingAttachments.some(a => a.isUploading)) return;
    if (claudeSession) {
      if (sendMode === 'goal') {
        if (!trimmed || trimmed.length > 4000 || /[\r\n]/.test(trimmed) || pendingAttachments.length) return;
        onSendMessage(trimmed, undefined, undefined, { condition: trimmed });
        cleanupPending();
        setSendMode('chat');
        return;
      }
      const images = pendingAttachments.filter(a => a.uploadedId && a.uploadedKind === 'image')
        .map(a => ({ id: a.uploadedId!, kind: 'image' as const }));
      if ((!trimmed && !images.length) || images.length !== pendingAttachments.length) return;
      onSendMessage(trimmed, images.length ? images : undefined);
      cleanupPending();
      return;
    }
    if (codexSession) {
      if (sendMode === 'goal') {
        if (!trimmed || pendingAttachments.length > 0 || !budgetValid) return;
        onSendMessage(trimmed, undefined, undefined, { condition: trimmed, tokenBudget: goalTokenBudget });
        cleanupPending();
        setSendMode('chat');
        return;
      }
      const images = pendingAttachments.filter(a => a.uploadedId && a.uploadedKind === 'image')
        .map(a => ({ id: a.uploadedId!, kind: 'image' as const }));
      if (images.length !== pendingAttachments.length) return;
      const parsed = extractPromptCommand(input);
      const prompt = parsed && prompts.find(p => p.name === parsed.command);
      const content = prompt ? expandPromptContent(prompt, parsed.rest) : trimmed;
      onSendMessage(content, images.length ? images : undefined);
      cleanupPending();
      return;
    }

    if (sendMode === 'goal') {
      onSendMessage(trimmed, undefined, undefined, { condition: trimmed, maxTurns: goalMaxTurns });
      cleanupPending();
      setSelectedResponseFormatId(undefined);
      setSendMode('chat');
      return;
    }

    const parsed = extractPromptCommand(input);
    if (parsed) {
      const prompt = prompts.find(p => p.name === parsed.command);
      if (prompt) {
        const expanded = expandPromptContent(prompt, parsed.rest);
        const uploadedAttachments = pendingAttachments
          .filter(a => a.uploadedId)
          .map(a => ({ id: a.uploadedId!, kind: a.uploadedKind! }));
        onSendMessage(expanded, uploadedAttachments.length > 0 ? uploadedAttachments : undefined, selectedResponseFormatId);
        cleanupPending();
        setSelectedResponseFormatId(undefined);
        return;
      }
    }

    const uploadedAttachments = pendingAttachments
      .filter(a => a.uploadedId)
      .map(a => ({ id: a.uploadedId!, kind: a.uploadedKind! }));
    onSendMessage(trimmed || '', uploadedAttachments.length > 0 ? uploadedAttachments : undefined, selectedResponseFormatId);
    cleanupPending();
    setSelectedResponseFormatId(undefined);
  };

  /** Keys from the composer; true when handled here. */
  const handleKeyDown = (e: KeyboardEvent): boolean => {
    if (showPromptAc && filteredPrompts.length > 0) {
      switch (e.key) {
        case 'ArrowDown':
          setSelectedIndex(i => (i + 1) % filteredPrompts.length);
          return true;
        case 'ArrowUp':
          setSelectedIndex(i => (i - 1 + filteredPrompts.length) % filteredPrompts.length);
          return true;
        case 'Enter':
          if (e.shiftKey) return false;
          if (filteredPrompts[selectedIndex]) handlePromptSelect(filteredPrompts[selectedIndex]);
          return true;
        case 'Tab':
          if (filteredPrompts[selectedIndex]) handlePromptSelect(filteredPrompts[selectedIndex]);
          return true;
        case 'Escape':
          closeAutocomplete();
          return true;
      }
    }

    if (showFileAc && autocompleteFiles.length > 0) {
      const file = autocompleteFiles[selectedIndex];
      switch (e.key) {
        case 'ArrowDown':
          setSelectedIndex(i => (i + 1) % autocompleteFiles.length);
          return true;
        case 'ArrowUp':
          setSelectedIndex(i => (i - 1 + autocompleteFiles.length) % autocompleteFiles.length);
          return true;
        case 'Enter':
          if (file) handleFileSelect(file);
          return true;
        case 'Tab':
          // Tab on a folder keeps searching inside it; Enter references the folder itself.
          if (file?.type === 'directory' && trigger) {
            editorRef.current?.replaceTrigger(trigger, { text: `@${file.path}/` });
          } else if (file) {
            handleFileSelect(file);
          }
          return true;
        case 'Escape':
          closeAutocomplete();
          return true;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      void handleSubmit();
      return true;
    }
    return false;
  };

  const handleFilesChange = useCallback((files: FileEntry[]) => {
    setAutocompleteFiles(files);
  }, []);

  const trimmed = input.trim();
  const hasUploadingAttachment = pendingAttachments.some(a => a.isUploading);
  const canSend = trimmed || pendingAttachments.length > 0;
  const isDisabled = !canSend || effectiveDisabled || hasUploadingAttachment
    || (sendMode === 'goal' && (!trimmed || pendingAttachments.length > 0
      || claudeSession && (trimmed.length > 4000 || /[\r\n]/.test(trimmed)) || codexSession && !budgetValid));
  const steerHint = onSteerQueued && sendMode === 'chat' && !disabled;
  const steerByDefault = followUpMode === 'steer' && session?.harnessState?.capabilities?.canSteerQueuedMessages === true;
  const effectivePlaceholder = goalActive
    ? 'Goal active'
    : steerHint ? 'Press Enter to steer the queued message'
    : claudeSession && sendMode !== 'goal' ? 'Message Claude CLI (text and images)'
      : codexSession && sendMode !== 'goal'
        ? 'Message Codex CLI (/ prompts, @ files)'
      : sendMode === 'goal'
        ? 'Type the completion condition...'
        : `${placeholder}  (/ prompts, @ files)`;

  return (
    <form
      onSubmit={handleSubmit}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        // The chips under the editor size to this container (see ui/chip.tsx),
        // so a narrow pane on a wide window folds them like a phone does.
        '@container/chips mx-auto w-full max-w-3xl px-4 pt-2 pb-4',
        isDragOver && 'ring-2 ring-highlight'
      )}
    >
      <div
        className={cn(
          // The composer is a surface on the session pane (bg-card), not a form
          // field. Idle is flat: hairline and a fill one step off the pane. Focus
          // lifts the surface (composer-field in index.css): popover fill and the
          // panel shadow. The hairline never changes; see docs/plans/composer-focus.md.
          'composer-field relative z-10 overflow-hidden rounded-2xl border border-input bg-background/60 dark:bg-input/30',
          'transition-[background-color,box-shadow] focus-within:bg-popover',
          isDragOver && 'border-highlight/50'
        )}
      >
        {pendingAttachments.length > 0 && (
          <div className="flex gap-2 flex-wrap px-3 pt-3">
            {pendingAttachments.map(a => (
              <PendingAttachment
                key={a.id}
                id={a.id}
                kind={a.kind}
                filename={a.filename}
                size={a.size}
                previewUrl={a.previewUrl}
                isUploading={a.isUploading}
                onRemove={removeAttachment}
              />
            ))}
          </div>
        )}
        {!codexSession && !claudeSession && pendingAttachments.length > 0 && modelSupportsImage === false && (
          <div className="flex items-center gap-1.5 px-3 pt-2 text-xs text-warning">
            <AlertTriangle className="size-3 shrink-0" />
            <span>This model will not inspect images directly. They will be sent as file paths instead.</span>
          </div>
        )}
        {goal?.status === 'active' && (
          <div className="flex items-center gap-2 px-3 pt-3 text-xs text-muted-foreground">
            <Target className="size-3 shrink-0" />
            <span className="min-w-0 truncate" title={goal.objective ?? ''}>{goal.objective}</span>
            <span className="ml-auto shrink-0 tabular-nums">
              {goal.status}
              {goal.progress && (
                <> · {goal.progress.kind === 'tokens'
                  ? `${goal.progress.current.toLocaleString()}/${goal.progress.max?.toLocaleString() ?? 'unlimited'} tokens`
                  : goal.progress.kind === 'iterations'
                    ? `${goal.progress.current} checks`
                    : `Turn ${goal.progress.current}/${goal.progress.max ?? 0}`}</>
              )}
            </span>
          </div>
        )}
        <div className="relative">
          <Popover open={showPromptAc || showFileAc} onOpenChange={(open) => {
            if (!open) closeAutocomplete();
          }}>
            <PopoverAnchor asChild>
              <div className="chat-input-scrollbar max-h-[200px] min-h-16 overflow-y-auto px-4 pt-3 pb-1 text-[16px] leading-6 md:text-base">
                <ComposerEditor
                  ref={editorRef}
                  value={input}
                  onChange={setInput}
                  onTriggerChange={handleTriggerChange}
                  onKeyDown={handleKeyDown}
                  onPasteFiles={handlePasteFiles}
                  onOpenFile={openContextFile}
                  placeholder={effectivePlaceholder}
                  disabled={disabled || goalActive}
                />
              </div>
            </PopoverAnchor>

            <PopoverContent
              className={cn('p-0', showFileAc ? 'w-96' : 'w-72')}
              align="start"
              side="top"
              sideOffset={8}
              onOpenAutoFocus={(e) => e.preventDefault()}
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              {showFileAc ? (
                <FileAutocomplete
                  workspaceId={workspaceId || ''}
                  searchQuery={trigger?.kind === 'file' ? trigger.query : ''}
                  selectedIndex={selectedIndex}
                  onSelectedIndexChange={setSelectedIndex}
                  onSelect={handleFileSelect}
                  onFilesChange={handleFilesChange}
                  sdkClient={sdkClient}
                  root={referenceRoot}
                />
              ) : (
                <PromptAutocomplete
                  prompts={prompts}
                  query={promptQuery}
                  selectedIndex={selectedIndex}
                  onSelect={handlePromptSelect}
                />
              )}
            </PopoverContent>
          </Popover>
        </div>

        {/* Bottom row of the field: what the session runs as at the left (one line that scrolls), attach and send at the right. */}
        <div className="flex items-center gap-2 px-2 pb-2 pt-0.5">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {sessionId && (
          <>
            {session && (
              <SessionCheckoutSelector
                session={session}
                sdkClient={sdkClient ?? null}
                disabled={disabled || checkoutLocked}
              />
            )}
            <AutoApproveSelector sessionId={sessionId} sdkClient={sdkClient ?? null} disabled={disabled} />
            {!codexSession && !claudeSession && <>
              <ResponseFormatSelector
                formats={responseFormats}
                selectedId={selectedResponseFormatId}
                onSelect={setSelectedResponseFormatId}
                disabled={disabled}
              />
            </>}
          </>
        )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              aria-label="Attach file"
            >
              <Paperclip className="size-4" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept={codexSession || claudeSession ? 'image/png,image/jpeg,image/webp,image/gif' : 'image/*,video/*,.pdf,.doc,.docx,.txt,.csv,.json,.xml,.md'}
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = '';
              }}
            />
            {/* Send is one control: the mode on its left half, the arrow on its right. */}
            <div className="flex items-center">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={goalActive}
                  className={cn(
                    'flex h-7 items-center gap-1 rounded-l-md pl-2.5 pr-1.5 text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50',
                    sendMode === 'goal'
                      ? 'bg-warning/15 text-warning hover:bg-warning/25'
                      : 'bg-foreground/6 text-muted-foreground hover:bg-foreground/10 hover:text-foreground',
                  )}
                  aria-label={`Send mode: ${sendMode}`}
                >
                  {sendMode === 'goal' && <Target className="size-3.5" />}
                  <span className="capitalize">{sendMode}</span>
                  <ChevronDown className="size-3 opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" sideOffset={8} className="w-56">
                <DropdownMenuLabel>Send Mode</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={(e) => e.preventDefault()}
                  onClick={() => setSendMode('chat')}
                >
                  <ArrowUp className="size-4 mr-2" />
                  <span>Chat</span>
                  {sendMode === 'chat' && <span className="ml-auto text-xs">✓</span>}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(e) => e.preventDefault()}
                  onClick={() => setSendMode('goal')}
                >
                  <Target className="size-4 mr-2" />
                  <span>Goal</span>
                  {sendMode === 'goal' && <span className="ml-auto text-xs">✓</span>}
                </DropdownMenuItem>
                {sendMode === 'goal' && !claudeSession && (
                  <>
                    <DropdownMenuSeparator />
                    {codexSession ? <div className="px-2 py-1.5 flex items-center justify-between gap-2">
                      <label htmlFor="codex-goal-budget" className="text-xs text-muted-foreground">Token budget</label>
                      <Input id="codex-goal-budget" type="number" min={1} max={1_000_000} step={1000}
                        value={goalTokenBudget} onChange={event => setGoalTokenBudget(Number(event.target.value))}
                        className="h-6 w-24 px-1.5 text-xs tabular-nums md:text-xs" />
                    </div> : <div className="px-2 py-1.5 flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">Max turns</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          className="flex items-center justify-center size-5 rounded-md bg-muted text-foreground hover:bg-accent text-xs"
                          onClick={() => setGoalMaxTurns(Math.max(1, goalMaxTurns - 1))}
                        >
                          −
                        </button>
                        <span className="w-6 text-center text-xs tabular-nums">{goalMaxTurns}</span>
                        <button
                          type="button"
                          className="flex items-center justify-center size-5 rounded-md bg-muted text-foreground hover:bg-accent text-xs"
                          onClick={() => setGoalMaxTurns(Math.min(100, goalMaxTurns + 1))}
                        >
                          +
                        </button>
                      </div>
                    </div>}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            {isStreaming && onStopStreaming && (!canSend || goalActive) ? (
              <button
                type="button"
                onClick={onStopStreaming}
                className="flex h-7 w-8 items-center justify-center rounded-r-md bg-destructive/15 text-destructive transition-colors hover:bg-destructive/25"
                aria-label="Stop"
                title="Stop (double Esc)"
              >
                <Square className="size-3.5" fill="currentColor" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={isDisabled}
                className={cn(
                  'flex h-7 w-8 items-center justify-center rounded-r-md transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50',
                  isDisabled
                    ? 'bg-foreground/6 text-muted-foreground'
                    : sendMode === 'goal'
                      ? 'bg-warning text-background hover:bg-warning/90'
                      : 'bg-highlight text-highlight-foreground hover:bg-highlight/90',
                )}
                aria-label={isStreaming ? (steerByDefault ? 'Steer message' : 'Queue message')
                  : sendMode === 'goal' ? 'Set goal' : 'Send message'}
                title={isStreaming ? (steerByDefault ? 'Steer message' : 'Queue message') : undefined}
              >
                <ArrowUp className="size-4" />
              </button>
            )}
            </div>
          </div>
        </div>
      </div>

      {session && (
        <SessionCheckoutStrip
          session={session}
          sdkClient={sdkClient ?? null}
          locked={checkoutLocked}
        />
      )}
    </form>
  );
});
