/**
 * Context references inside a user prompt. The prompt stays one string:
 *
 * - a file is a markdown link whose label is its basename, `[auth.ts:12-40](src/auth.ts#L12-L40)`,
 *   with the path relative to the session's checkout root;
 * - a terminal excerpt is `[zsh · 14 lines](#context-t1)` in the body, with the captured text in
 *   one `<prokop_context>` envelope that ends the prompt.
 *
 * Models read both forms as written, so no harness rewrites them. Clients turn them into chips.
 */

export interface FileContextReference {
  kind: 'file';
  /** Relative to the session's checkout root. Folders end with `/`. */
  path: string;
  lineStart?: number;
  lineEnd?: number;
}

export interface TerminalContextReference {
  kind: 'terminal';
  id: string;
  /** Terminal name, such as the shell or tab title. */
  label: string;
  cwd?: string;
  text: string;
}

export type ContextReference = FileContextReference | TerminalContextReference;

export type ContextSegment =
  | { type: 'text'; text: string }
  | { type: 'reference'; reference: ContextReference; source: string }
  /** A terminal marker whose envelope entry is missing. */
  | { type: 'missing'; id: string; label: string; source: string };

const ENVELOPE_TAG = 'prokop_context';
const TERMINAL_TAG = 'terminal';
const TERMINAL_ID_PATTERN = /^[a-z0-9-]{1,40}$/i;
const MAX_LABEL_LENGTH = 512;
const LINK = new RegExp(String.raw`(!?)\[([^\]\n]{1,${MAX_LABEL_LENGTH}})\]\((<[^<>\n]+>|[^\s()<>]+)\)`, 'g');
const URI_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const LINE_FRAGMENT = /^L(\d+)(?:-L?(\d+))?$/;
const TERMINAL_FRAGMENT = /^#context-([a-z0-9-]{1,40})$/i;
const ENVELOPE_OPEN = `<${ENVELOPE_TAG}>\n`;
const ENVELOPE_REST = new RegExp(String.raw`^([\s\S]*)\n</${ENVELOPE_TAG}>\s*$`);
const ENTRY = new RegExp(String.raw`<${TERMINAL_TAG}((?:\s+[a-z]+="[^"]*")*)>\n([\s\S]*?)\n</${TERMINAL_TAG}>`, 'g');
const ATTRIBUTE = /([a-z]+)="([^"]*)"/g;
// Captured output is data: a line containing `</terminal>` must not close its entry.
const CLOSING_TAG = new RegExp(String.raw`<(?=/?(?:${ENVELOPE_TAG}|${TERMINAL_TAG})\b)`, 'gi');
const ESCAPED_CLOSING_TAG = new RegExp(String.raw`&lt;(?=/?(?:${ENVELOPE_TAG}|${TERMINAL_TAG})\b)`, 'gi');

function basename(path: string): string {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  return trimmed.slice(trimmed.lastIndexOf('/') + 1);
}

function lineSuffix(reference: FileContextReference): string {
  if (reference.lineStart === undefined) return '';
  return reference.lineEnd !== undefined && reference.lineEnd !== reference.lineStart
    ? `:${reference.lineStart}-${reference.lineEnd}`
    : `:${reference.lineStart}`;
}

/** Chip and link text: `auth.ts`, `auth.ts:12-40`, `src/`, `zsh · 14 lines`. */
export function contextReferenceLabel(reference: ContextReference): string {
  if (reference.kind === 'terminal') {
    const lines = reference.text.split('\n').length;
    return `${reference.label} · ${lines} ${lines === 1 ? 'line' : 'lines'}`;
  }
  const name = basename(reference.path);
  return reference.path.endsWith('/') ? `${name}/` : `${name}${lineSuffix(reference)}`;
}

/** `src/auth.ts:12-40`, the form people type and paste. */
export function fileReferenceDisplayPath(reference: FileContextReference): string {
  return `${reference.path}${lineSuffix(reference)}`;
}

function sanitizeLabel(label: string): string {
  return label.replace(/[[\]\\\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL_LENGTH) || 'context';
}

/** The marker that stands for a reference in the prompt body. */
export function formatContextReference(reference: ContextReference): string {
  const label = sanitizeLabel(contextReferenceLabel(reference));
  if (reference.kind === 'terminal') return `[${label}](#context-${reference.id})`;
  const fragment = reference.lineStart === undefined
    ? ''
    : reference.lineEnd !== undefined && reference.lineEnd !== reference.lineStart
      ? `#L${reference.lineStart}-L${reference.lineEnd}`
      : `#L${reference.lineStart}`;
  const destination = `${reference.path}${fragment}`;
  return `[${label}](${/[\s()<>]/.test(destination) ? `<${destination}>` : destination})`;
}

function parseLineFragment(fragment: string): Pick<FileContextReference, 'lineStart' | 'lineEnd'> | null {
  const match = LINE_FRAGMENT.exec(fragment);
  if (!match) return null;
  const lineStart = Number(match[1]);
  const lineEnd = match[2] === undefined ? lineStart : Number(match[2]);
  if (lineStart < 1 || lineEnd < lineStart) return null;
  return lineEnd === lineStart ? { lineStart } : { lineStart, lineEnd };
}

/**
 * Reads a file reference from a link's label and destination. Only links whose label is the
 * basename (plus the same line range) count, so ordinary markdown links stay links.
 */
export function parseFileReferenceLink(label: string, destination: string): FileContextReference | null {
  let target = destination.startsWith('<') && destination.endsWith('>') ? destination.slice(1, -1) : destination;
  if (!target || target.startsWith('/') || target.startsWith('#') || URI_SCHEME.test(target)) return null;
  if (target.includes('%')) {
    try { target = decodeURI(target); } catch { return null; }
  }
  const hashIndex = target.indexOf('#');
  const path = hashIndex === -1 ? target : target.slice(0, hashIndex);
  if (!path || path.includes('\\') || path.split('/').some((segment) => segment === '..')) return null;
  const range = hashIndex === -1 ? {} : parseLineFragment(target.slice(hashIndex + 1));
  if (!range) return null;
  if (path.endsWith('/') && range.lineStart !== undefined) return null;
  const reference: FileContextReference = { kind: 'file', path, ...range };
  return contextReferenceLabel(reference) === label.trim() ? reference : null;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function unescapeAttribute(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function parseEnvelope(content: string): Map<string, TerminalContextReference> | null {
  const terminals = new Map<string, TerminalContextReference>();
  let cursor = 0;
  for (const match of content.matchAll(ENTRY)) {
    if (content.slice(cursor, match.index).trim()) return null;
    cursor = match.index + match[0].length;
    const attributes = new Map<string, string>();
    for (const attribute of match[1].matchAll(ATTRIBUTE)) attributes.set(attribute[1], unescapeAttribute(attribute[2]));
    const id = attributes.get('id');
    const label = attributes.get('label');
    if (!id || !TERMINAL_ID_PATTERN.test(id) || !label || terminals.has(id)) return null;
    const cwd = attributes.get('cwd');
    terminals.set(id, {
      kind: 'terminal',
      id,
      label,
      ...(cwd ? { cwd } : {}),
      text: match[2].replace(ESCAPED_CLOSING_TAG, '<'),
    });
  }
  return content.slice(cursor).trim() ? null : terminals;
}

/** Separates the prompt body from a trailing, well-formed envelope. */
export function splitContextEnvelope(text: string): { body: string; terminals: Map<string, TerminalContextReference> } {
  // Escaping keeps captured text free of envelope tags, so the last opening tag is ours.
  const start = text.lastIndexOf(ENVELOPE_OPEN);
  if (start === -1 || (start > 0 && text[start - 1] !== '\n')) return { body: text, terminals: new Map() };
  const match = ENVELOPE_REST.exec(text.slice(start + ENVELOPE_OPEN.length));
  const terminals = match ? parseEnvelope(match[1]) : null;
  if (!terminals) return { body: text, terminals: new Map() };
  return { body: text.slice(0, start).replace(/\n+$/, ''), terminals };
}

function formatEnvelopeEntry(reference: TerminalContextReference): string {
  const attributes = [`id="${escapeAttribute(reference.id)}"`, `label="${escapeAttribute(reference.label)}"`];
  if (reference.cwd) attributes.push(`cwd="${escapeAttribute(reference.cwd)}"`);
  return `<${TERMINAL_TAG} ${attributes.join(' ')}>\n${reference.text.replace(CLOSING_TAG, '&lt;')}\n</${TERMINAL_TAG}>`;
}

/** Splits a body into text and references. Terminal payloads come from the envelope. */
export function collectContextSegments(
  body: string,
  terminals: ReadonlyMap<string, TerminalContextReference> = new Map(),
): ContextSegment[] {
  const segments: ContextSegment[] = [];
  let cursor = 0;
  const pushText = (text: string): void => {
    if (!text) return;
    const last = segments[segments.length - 1];
    if (last?.type === 'text') last.text += text;
    else segments.push({ type: 'text', text });
  };
  if (body.includes('](')) {
    for (const match of body.matchAll(LINK)) {
      if (match[1] === '!') continue;
      const [source, , label, destination] = match;
      let segment: ContextSegment | null = null;
      const terminalId = TERMINAL_FRAGMENT.exec(destination)?.[1];
      if (terminalId) {
        const terminal = terminals.get(terminalId);
        segment = terminal
          ? { type: 'reference', reference: terminal, source }
          : { type: 'missing', id: terminalId, label, source };
      } else {
        const reference = parseFileReferenceLink(label, destination);
        if (reference) segment = { type: 'reference', reference, source };
      }
      if (!segment) continue;
      pushText(body.slice(cursor, match.index));
      segments.push(segment);
      cursor = match.index + source.length;
    }
  }
  pushText(body.slice(cursor));
  return segments;
}

/** Parses a whole prompt (body plus envelope) into segments. */
export function parseContextMessage(text: string): ContextSegment[] {
  const { body, terminals } = splitContextEnvelope(text);
  return collectContextSegments(body, terminals);
}

/**
 * Joins a body with the envelope for the terminal references it still contains, in first-use
 * order. Unreferenced payloads are dropped.
 */
export function joinContextEnvelope(body: string, terminals: Iterable<TerminalContextReference>): string {
  const byId = new Map<string, TerminalContextReference>();
  for (const terminal of terminals) byId.set(terminal.id, terminal);
  const used: TerminalContextReference[] = [];
  for (const segment of collectContextSegments(body, byId)) {
    if (segment.type === 'reference' && segment.reference.kind === 'terminal' && !used.includes(segment.reference)) {
      used.push(segment.reference);
    }
  }
  if (used.length === 0) return body;
  return `${body.trimEnd()}\n\n<${ENVELOPE_TAG}>\n${used.map(formatEnvelopeEntry).join('\n')}\n</${ENVELOPE_TAG}>`;
}

/** Builds a prompt from segments, adding the envelope for its terminal references. */
export function serializeContextSegments(segments: readonly ContextSegment[]): string {
  const terminals: TerminalContextReference[] = [];
  let body = '';
  for (const segment of segments) {
    if (segment.type === 'text') body += segment.text;
    else if (segment.type === 'missing') body += segment.source;
    else {
      if (segment.reference.kind === 'terminal') terminals.push(segment.reference);
      body += formatContextReference(segment.reference);
    }
  }
  return joinContextEnvelope(body, terminals);
}

export interface ContextPlainTextOptions {
  /** `label` keeps one-line previews short; `fenced` copies the captured output. */
  terminals?: 'label' | 'fenced';
}

/** The prompt as people would type it: `src/auth.ts:12-40`, terminals as labels or code blocks. */
export function contextMessagePlainText(text: string, options: ContextPlainTextOptions = {}): string {
  return parseContextMessage(text).map((segment) => {
    if (segment.type === 'text') return segment.text;
    if (segment.type === 'missing') return segment.label;
    const reference = segment.reference;
    if (reference.kind === 'file') return fileReferenceDisplayPath(reference);
    if (options.terminals !== 'fenced') return contextReferenceLabel(reference);
    const fence = reference.text.includes('```') ? '````' : '```';
    return `\n${fence}\n${reference.text}\n${fence}\n`;
  }).join('').trim();
}

/** Short random id for a new terminal reference. */
export function createContextReferenceId(): string {
  return `t${Math.random().toString(36).slice(2, 8)}`;
}
