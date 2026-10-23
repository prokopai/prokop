/**
 * A note the host delivers to a session, as opposed to a prompt a person
 * typed: a background shell command finished, a delegated task finished or
 * needs an answer. The note is a user-role message whose text starts with one
 * header line:
 *
 *   <prokop_event kind="shell" id="c3" label="bun test" outcome="ok" meta="exit 0 · 2.1 s">Background command c3 finished successfully after 2.1 s: `bun test`</prokop_event>
 *   [bun test](#context-c3)
 *   Full output: /tmp/.../c3.out
 *
 * The sentence inside the tag is what the model reads; the attributes are what
 * clients render as an event row. Models read the header as written, so no
 * harness rewrites it. A header the parser does not accept is ordinary text.
 */

/** `shell`: a background command. `task`: a delegated task. `message`: a message from another agent. */
export type HostEventKind = 'shell' | 'task' | 'message';

export type HostEventOutcome = 'ok' | 'error' | 'ask' | 'stopped';

export interface HostEvent {
  kind: HostEventKind;
  /** Shell: the command id. Task: the child session id. Message: the sender's session id. */
  id: string;
  /** Shell: the command. Task: its description. Message: the sender's name. */
  label: string;
  outcome: HostEventOutcome;
  /** Short facts for the row: `exit 0 · 2.1 s`, `codex-cli · gpt-5.5`. */
  meta?: string;
  /** The one-line sentence the model reads. */
  summary: string;
}

const TAG = 'prokop_event';
const KINDS: ReadonlySet<string> = new Set<HostEventKind>(['shell', 'task', 'message']);
const OUTCOMES: ReadonlySet<string> = new Set<HostEventOutcome>(['ok', 'error', 'ask', 'stopped']);
const HEADER = new RegExp(String.raw`^<${TAG}((?:\s+[a-z]+="[^"]*")+)>([^\n]*)</${TAG}>(?:\n|$)`);
const ATTRIBUTE = /([a-z]+)="([^"]*)"/g;

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function unescapeAttribute(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** The note text: the header line, then the body. */
export function formatHostEvent(event: HostEvent, body = ''): string {
  const attributes = [
    `kind="${event.kind}"`,
    `id="${escapeAttribute(oneLine(event.id))}"`,
    `label="${escapeAttribute(oneLine(event.label))}"`,
    `outcome="${event.outcome}"`,
  ];
  if (event.meta) attributes.push(`meta="${escapeAttribute(oneLine(event.meta))}"`);
  // The summary closes the tag on the same line, so it must not contain a newline or the closing tag.
  const summary = oneLine(event.summary).replace(new RegExp(`</?${TAG}[^>]*>?`, 'g'), '');
  const header = `<${TAG} ${attributes.join(' ')}>${summary}</${TAG}>`;
  return body ? `${header}\n${body}` : header;
}

/** Separates a leading header from the rest of the note. Text without one is all body. */
export function splitHostEvent(text: string): { event: HostEvent | null; body: string } {
  if (!text.startsWith(`<${TAG} `)) return { event: null, body: text };
  const match = HEADER.exec(text);
  if (!match) return { event: null, body: text };
  const attributes = new Map<string, string>();
  for (const attribute of match[1].matchAll(ATTRIBUTE)) attributes.set(attribute[1], unescapeAttribute(attribute[2]));
  const kind = attributes.get('kind');
  const id = attributes.get('id');
  const label = attributes.get('label');
  const outcome = attributes.get('outcome');
  if (!kind || !KINDS.has(kind) || !id || !label || !outcome || !OUTCOMES.has(outcome)) return { event: null, body: text };
  const meta = attributes.get('meta');
  return {
    event: {
      kind: kind as HostEventKind,
      id,
      label,
      outcome: outcome as HostEventOutcome,
      ...(meta ? { meta } : {}),
      summary: match[2].trim(),
    },
    body: text.slice(match[0].length),
  };
}

/** The note as people would read it: the summary sentence, then the body. */
export function hostEventPlainText(text: string): string {
  const { event, body } = splitHostEvent(text);
  if (!event) return text;
  return body ? `${event.summary}\n${body}` : event.summary;
}
