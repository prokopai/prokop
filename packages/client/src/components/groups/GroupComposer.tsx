import { useCallback, useImperativeHandle, useRef, useState, type FormEvent, type Ref } from 'react';
import { ArrowUp, AtSign, Loader2, Square } from 'lucide-react';
import type { PermissionMode, PromptInfo } from '@prokopai/sdk';
import { PermissionModeChip } from '@/components/chat/AutoApproveSelector';
import { ComposerEditor, type ComposerEditorHandle, type ComposerTrigger } from '@/components/chat/ComposerEditor';
import { PromptAutocomplete } from '@/components/chat/PromptAutocomplete';
import { expandPromptInput } from '@/components/chat/promptCommands';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface GroupComposerMember {
  agentId: string;
  name: string;
}

export interface GroupComposerHandle {
  focus(): void;
}

export interface GroupComposerProps {
  /** Lets the view focus the editor, for the focus-input shortcut. */
  ref?: Ref<GroupComposerHandle>;
  members: readonly GroupComposerMember[];
  /** Woken when the message names nobody. */
  defaultAgentId: string;
  disabled?: boolean;
  sending?: boolean;
  /** At least one member is working: with nothing typed, the send button is Stop. */
  working?: boolean;
  /** Interrupts every working member. */
  onStop?: () => void;
  /** The group's permission mode, one setting for every member; the shield shows when it can be changed. */
  permissionMode?: PermissionMode;
  onPermissionModeChange?: (mode: PermissionMode) => void;
  /** Slash prompts, as in a session: `/name rest` sends the prompt's content. */
  prompts?: readonly PromptInfo[];
  /** `mentions` are member ids picked from the list; they decide who answers. */
  onSend: (text: string, mentions: string[]) => void | Promise<void>;
}

interface Suggestion {
  id: string;
  name: string;
  everyone?: true;
}

/** Any `@Name` in the text: the server routes on it too. */
const MENTION_IN_TEXT = /(^|\s)@\S/;

export function suggestionsFor(query: string, members: readonly GroupComposerMember[]): Suggestion[] {
  const needle = query.toLowerCase();
  const list: Suggestion[] = members
    .filter((member) => member.name.toLowerCase().includes(needle) || member.agentId.toLowerCase().includes(needle))
    .map((member) => ({ id: member.agentId, name: member.name }));
  if ('everyone'.startsWith(needle)) list.push({ id: '*', name: 'everyone', everyone: true });
  return list;
}

const NO_PROMPTS: readonly PromptInfo[] = [];

/**
 * The group's message box: the chat composer, with `@` listing the members
 * (and everyone) instead of files and `/` listing the prompts as in a
 * session. Picking a member writes `@Name` and remembers the member, so
 * routing is explicit; Enter sends, Shift+Enter breaks the line; a message
 * that names nobody says who it will go to. The permission shield is the
 * group's: every member session follows it.
 */
export function GroupComposer({ ref, members, defaultAgentId, disabled, sending, working, onStop, permissionMode = 'standard', onPermissionModeChange, prompts = NO_PROMPTS, onSend }: GroupComposerProps) {
  const editorRef = useRef<ComposerEditorHandle | null>(null);
  useImperativeHandle(ref, () => ({ focus: () => editorRef.current?.focus() }), []);
  const [input, setInput] = useState('');
  const [mentions, setMentions] = useState<string[]>([]);
  const [trigger, setTrigger] = useState<ComposerTrigger | null>(null);
  const [dismissed, setDismissed] = useState<ComposerTrigger | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const suggestions = trigger?.kind === 'file' ? suggestionsFor(trigger.query, members) : [];
  const promptQuery = trigger?.kind === 'prompt' ? trigger.query : '';
  const promptMatches = trigger?.kind === 'prompt' ? prompts.filter((prompt) => prompt.name.toLowerCase().includes(promptQuery.toLowerCase())) : [];
  const promptsOpen = trigger?.kind === 'prompt' && trigger !== dismissed && prompts.length > 0;
  const open = (!!trigger && trigger !== dismissed && suggestions.length > 0) || promptsOpen;
  const nameOf = (agentId: string) => members.find((member) => member.agentId === agentId)?.name ?? agentId;
  const explicit = mentions.length > 0 || MENTION_IN_TEXT.test(input);
  const canSend = input.trim().length > 0 && !disabled && !sending;

  const handleTriggerChange = useCallback((next: ComposerTrigger | null) => {
    setTrigger(next);
    setSelectedIndex(0);
  }, []);

  const pick = (suggestion: Suggestion) => {
    if (!trigger) return;
    editorRef.current?.replaceTrigger(trigger, { text: `@${suggestion.name} ` });
    if (!suggestion.everyone) setMentions((current) => (current.includes(suggestion.id) ? current : [...current, suggestion.id]));
  };

  const pickPrompt = (prompt: PromptInfo) => {
    if (!trigger) return;
    editorRef.current?.replaceTrigger(trigger, { text: `/${prompt.name} ` });
  };

  const send = async () => {
    if (!input.trim() || disabled || sending) return;
    // A slash prompt sends its content; an @Name in the rest still routes, since it stays in the text.
    const text = expandPromptInput(input, prompts);
    // Only members still named in the text route; a name the person deleted does not.
    const kept = mentions.filter((agentId) => text.includes(`@${nameOf(agentId)}`));
    // The box clears at once, like a session's; a failed send puts the text back.
    const typed = input;
    const typedMentions = mentions;
    setInput('');
    setMentions([]);
    try {
      await onSend(text, kept);
    } catch {
      setInput(typed);
      setMentions(typedMentions);
    }
  };

  const handleKeyDown = (event: KeyboardEvent): boolean => {
    if (promptsOpen) {
      switch (event.key) {
        case 'ArrowDown': setSelectedIndex((index) => (index + 1) % Math.max(promptMatches.length, 1)); return true;
        case 'ArrowUp': setSelectedIndex((index) => (index - 1 + promptMatches.length) % Math.max(promptMatches.length, 1)); return true;
        case 'Enter':
        case 'Tab': {
          if (event.key === 'Enter' && event.shiftKey) return false;
          const prompt = promptMatches[selectedIndex] ?? promptMatches[0];
          if (!prompt) return false;
          pickPrompt(prompt);
          return true;
        }
        case 'Escape': setDismissed(trigger); return true;
      }
    } else if (open) {
      switch (event.key) {
        case 'ArrowDown': setSelectedIndex((index) => (index + 1) % suggestions.length); return true;
        case 'ArrowUp': setSelectedIndex((index) => (index - 1 + suggestions.length) % suggestions.length); return true;
        case 'Enter':
          if (event.shiftKey) return false;
          pick(suggestions[selectedIndex] ?? suggestions[0]!);
          return true;
        case 'Tab': pick(suggestions[selectedIndex] ?? suggestions[0]!); return true;
        case 'Escape': setDismissed(trigger); return true;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      void send();
      return true;
    }
    return false;
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send();
  };

  return (
    <form onSubmit={handleSubmit} className="@container/chips mx-auto w-full max-w-3xl px-4 pt-2 pb-4">
      <div className="composer-field relative z-10 overflow-hidden rounded-2xl border border-input bg-background/60 transition-[background-color,box-shadow] focus-within:bg-popover dark:bg-input/30">
        <div className="relative">
          <Popover open={open} onOpenChange={(next) => { if (!next) setDismissed(trigger); }}>
            <PopoverAnchor asChild>
              <div className="chat-input-scrollbar max-h-[200px] min-h-16 overflow-y-auto px-4 pt-3 pb-1 text-[16px] leading-6 md:text-base">
                <ComposerEditor
                  ref={editorRef}
                  value={input}
                  onChange={setInput}
                  onTriggerChange={handleTriggerChange}
                  onKeyDown={handleKeyDown}
                  placeholder={prompts.length > 0 ? 'Message the group  (/ prompts, @ who should answer)' : 'Message the group  (@ who should answer)'}
                  disabled={disabled}
                />
              </div>
            </PopoverAnchor>
            <PopoverContent className={cn('p-1', promptsOpen ? 'w-80 p-0' : 'w-72')} align="start" side="top" sideOffset={8}
              onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={(event) => event.preventDefault()}>
              {promptsOpen ? (
                <PromptAutocomplete prompts={[...prompts]} query={promptQuery} selectedIndex={selectedIndex} onSelect={pickPrompt} />
              ) : (
              <div role="listbox" aria-label="Members">
                {suggestions.map((suggestion, index) => (
                  <button
                    key={suggestion.id}
                    type="button"
                    role="option"
                    aria-selected={index === selectedIndex}
                    onClick={() => pick(suggestion)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted',
                      index === selectedIndex && 'bg-highlight/15 text-foreground',
                    )}
                  >
                    <AtSign className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate">{suggestion.name}</span>
                    {suggestion.everyone && <span className="ml-auto text-xs text-muted-foreground">all members</span>}
                  </button>
                ))}
              </div>
              )}
            </PopoverContent>
          </Popover>
        </div>
        {/* Bottom row of the field: the group's shield and who a plain message goes to at the left, send at the right. */}
        <div className="flex items-center gap-2 px-2 pb-2 pt-0.5">
          {onPermissionModeChange && <PermissionModeChip mode={permissionMode} onChange={onPermissionModeChange} disabled={disabled} />}
          <div className="min-w-0 flex-1 truncate pl-1 text-xs text-muted-foreground" aria-live="polite">
            {!explicit && input.trim() ? `Goes to ${nameOf(defaultAgentId)}` : ''}
          </div>
          {working && onStop && !input.trim() ? (
            // The same stop as a session's: red square where send was, while members work and nothing is typed.
            <button
              type="button"
              onClick={onStop}
              className="flex h-7 w-8 items-center justify-center rounded-md bg-destructive/15 text-destructive transition-colors hover:bg-destructive/25"
              aria-label="Stop"
              title="Stop every working member (double Esc)"
            >
              <Square className="size-3.5" fill="currentColor" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              className={cn(
                'flex h-7 w-8 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50',
                canSend ? 'bg-highlight text-highlight-foreground hover:bg-highlight/90' : 'bg-foreground/6 text-muted-foreground',
              )}
              aria-label="Send message"
            >
              {sending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
