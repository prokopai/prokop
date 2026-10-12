import type { MessageWithParts, Part, SessionHarness } from '@prokopai/sdk';

/**
 * Handoff brief for a harness switch inside one conversation. Built once from
 * Jean2's own transcript at switch time and frozen, so every turn of the new
 * segment carries identical instructions (stable for prompt caching). No model
 * call: the source harness may be out of usage.
 */

export const HANDOFF_BRIEF_MAX_CHARS = 24_000;
const RECENT_TURNS = 6;
const TEXT_MAX_CHARS = 4_000;
const FIRST_REQUEST_MAX_CHARS = 2_000;
const LINE_MAX_CHARS = 160;

export const HARNESS_LABELS: Record<SessionHarness, string> = {
  prokop: 'Prokop',
  'codex-cli': 'Codex CLI',
  'claude-cli': 'Claude Code',
};

interface Turn {
  user: string;
  replies: string[];
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max).trimEnd()} [truncated]` : trimmed;
}

function oneLine(text: string, max = LINE_MAX_CHARS): string {
  return clip(text.replace(/\s+/g, ' '), max);
}

function toolLine(part: Extract<Part, { type: 'tool' }>): string {
  const summary = part.presentation?.summary?.trim()
    || (Object.keys(part.state.input ?? {}).length ? JSON.stringify(part.state.input) : '');
  return `- tool ${part.name}${summary ? `: ${oneLine(summary)}` : ''} (${part.state.status})`;
}

function renderParts(parts: Part[]): string {
  const lines: string[] = [];
  for (const part of parts) {
    if (part.type === 'text' && part.text.trim()) lines.push(clip(part.text, TEXT_MAX_CHARS));
    else if (part.type === 'tool') lines.push(toolLine(part));
    else if (part.type === 'image') lines.push('[image attached]');
    else if (part.type === 'file') lines.push(`[file attached${part.filename ? `: ${oneLine(part.filename, 80)}` : ''}]`);
  }
  return lines.join('\n');
}

function groupTurns(messages: MessageWithParts[]): Turn[] {
  const turns: Turn[] = [];
  for (const { message, parts } of messages) {
    if (message.role === 'system') continue;
    if (message.role === 'user') {
      if (parts.every(part => part.type === 'compaction')) continue;
      turns.push({ user: renderParts(parts), replies: [] });
      continue;
    }
    if (message.mode === 'compact_failed' || message.mode === 'retry_failed') continue;
    const rendered = renderParts(parts);
    if (!rendered) continue;
    const reply = message.summary ? `[earlier context summary]\n${rendered}` : rendered;
    if (turns.length) turns.at(-1)!.replies.push(reply);
    else turns.push({ user: '', replies: [reply] });
  }
  return turns;
}

function renderTurn(turn: Turn): string {
  const sections = [];
  if (turn.user) sections.push(`User:\n${turn.user}`);
  if (turn.replies.length) sections.push(`Assistant:\n${turn.replies.join('\n')}`);
  return sections.join('\n');
}

export interface HandoffBriefInput {
  sessionId: string;
  from: SessionHarness;
  to: SessionHarness;
  messages: MessageWithParts[];
  maxChars?: number;
}

export function buildHandoffBrief(input: HandoffBriefInput): string {
  const maxChars = input.maxChars ?? HANDOFF_BRIEF_MAX_CHARS;
  const turns = groupTurns(input.messages);
  const sourceModel = [...input.messages].reverse()
    .find(entry => entry.message.role === 'assistant')?.message;
  const model = sourceModel && 'modelId' in sourceModel && sourceModel.modelId ? ` (${sourceModel.modelId})` : '';
  const header = [
    '## Conversation handoff',
    `This conversation started in ${HARNESS_LABELS[input.from]}${model} and now continues in ${HARNESS_LABELS[input.to]}.`
      + ' You did not see the earlier turns; below is a condensed copy of the stored transcript.',
    'Earlier work is already applied to the workspace. Do not redo it. Run `git status` to see uncommitted changes.',
    `For exact earlier details, use session_search with scope "current_session", or read mode with sessionId "${input.sessionId}", when that tool is available.`,
  ].join('\n');

  const first = turns[0]?.user ? clip(turns[0].user, FIRST_REQUEST_MAX_CHARS) : '';
  let recentStart = Math.max(0, turns.length - RECENT_TURNS);
  let earlier = turns.slice(1, recentStart).filter(turn => turn.user).map(turn => `- ${oneLine(turn.user)}`);

  const assemble = (): string => {
    const recent = turns.slice(recentStart).map(renderTurn).filter(Boolean);
    return [
      header,
      first && recentStart > 0 ? `### First request\n${first}` : '',
      earlier.length ? `### Earlier requests\n${earlier.join('\n')}` : '',
      recent.length ? `### Recent turns\n${recent.join('\n\n')}` : '',
    ].filter(Boolean).join('\n\n');
  };

  let brief = assemble();
  // Keep the newest turn verbatim longest: fold older recent turns into
  // one-line requests first, then drop the oldest one-liners.
  while (brief.length > maxChars && recentStart < turns.length - 1) {
    const folded = turns[recentStart]!;
    if (recentStart > 0 && folded.user) earlier.push(`- ${oneLine(folded.user)}`);
    recentStart++;
    brief = assemble();
  }
  while (brief.length > maxChars && earlier.length) {
    earlier = earlier.slice(1);
    brief = assemble();
  }
  return brief.length > maxChars ? `${brief.slice(0, maxChars).trimEnd()}\n[handoff truncated]` : brief;
}
