import { jsonSchema, tool, type Tool } from 'ai';
import { mcpToolOrigin } from '@prokopai/core/infrastructure/mcp/capability-tool';

/**
 * Deferred workspace MCP tools (docs/plans/mcp-tool-lookup.md). A workspace
 * with many MCP tools would spend thousands of tokens on their schemas every
 * step. Above the threshold the turn sends one `tool_search` tool that lists
 * them by name; the model loads the ones it needs with it, and from the next
 * step on those are ordinary callable tools for the rest of the session.
 * Every tool stays in the AI SDK tool set so earlier calls in the history
 * keep validating; `activeToolNames` decides what the provider sees.
 */

export const MCP_TOOL_SEARCH_THRESHOLD = 10;
export const TOOL_SEARCH_NAME = 'tool_search';
const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS_CAP = 20;
/** The catalog line's description is cut here, so forty tools stay a few hundred tokens. */
const CATALOG_DESCRIPTION_CHARS = 90;

export interface DeferredToolEntry {
  /** The key in the tool set, what the model calls. */
  name: string;
  serverName: string;
  toolName: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** The external MCP tools in a tool set: keyed `mcp_…` by the manager, with their origin attached. Built-in servers keep bare names and are never here. */
export function deferrableMcpTools(tools: Record<string, Tool>): DeferredToolEntry[] {
  const entries: DeferredToolEntry[] = [];
  for (const [name, candidate] of Object.entries(tools)) {
    if (!name.startsWith('mcp_')) continue;
    const origin = mcpToolOrigin(candidate);
    if (!origin) continue;
    entries.push({ name, serverName: origin.serverName, toolName: origin.toolName, description: candidate.description ?? '', inputSchema: origin.inputSchema });
  }
  return entries;
}

function tokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 1);
}

/**
 * `select:a,b` names tools exactly (by key or by the server's own tool name);
 * anything else is keywords, matched against the name, the server and the
 * description, best hits first.
 */
export function searchDeferredTools(query: string, catalog: readonly DeferredToolEntry[], maxResults = DEFAULT_MAX_RESULTS): { matches: DeferredToolEntry[]; unknown: string[] } {
  const trimmed = query.trim();
  const limit = Math.max(1, Math.min(MAX_RESULTS_CAP, maxResults));
  if (/^select:/i.test(trimmed)) {
    const wanted = trimmed.slice('select:'.length).split(',').map((part) => part.trim()).filter(Boolean);
    const matches: DeferredToolEntry[] = [];
    const unknown: string[] = [];
    for (const want of wanted) {
      const lower = want.toLowerCase();
      const found = catalog.find((entry) => entry.name.toLowerCase() === lower || entry.toolName.toLowerCase() === lower);
      if (found) { if (!matches.includes(found)) matches.push(found); } else unknown.push(want);
    }
    return { matches, unknown };
  }
  const words = tokens(trimmed);
  if (words.length === 0) return { matches: [], unknown: [] };
  const scored = catalog.map((entry) => {
    const haystack = [entry.name, entry.toolName, entry.serverName, entry.description].join(' ').toLowerCase();
    const nameText = `${entry.toolName} ${entry.name}`.toLowerCase();
    let score = 0;
    for (const word of words) {
      if (nameText.includes(word)) score += 3;
      else if (haystack.includes(word)) score += 1;
    }
    return { entry, score };
  }).filter((item) => item.score > 0);
  scored.sort((left, right) => right.score - left.score || left.entry.toolName.localeCompare(right.entry.toolName));
  return { matches: scored.slice(0, limit).map((item) => item.entry), unknown: [] };
}

interface SessionToolSearchState {
  deferred: Set<string>;
  loaded: Set<string>;
}

const sessions = new Map<string, SessionToolSearchState>();

/** Records which tools this session's turns defer; an empty list ends deferral. Loaded tools survive between turns. */
export function setDeferredTools(sessionId: string, names: readonly string[]): void {
  if (names.length === 0) {
    sessions.delete(sessionId);
    return;
  }
  const deferred = new Set(names);
  const previous = sessions.get(sessionId);
  const loaded = new Set([...(previous?.loaded ?? [])].filter((name) => deferred.has(name)));
  sessions.set(sessionId, { deferred, loaded });
}

export function loadDeferredTools(sessionId: string, names: readonly string[]): void {
  const state = sessions.get(sessionId);
  if (!state) return;
  for (const name of names) if (state.deferred.has(name)) state.loaded.add(name);
}

export function loadedDeferredTools(sessionId: string): string[] {
  return [...(sessions.get(sessionId)?.loaded ?? [])];
}

/** The tools the provider sees this step: everything but the deferred ones not loaded yet. Undefined when nothing is deferred (the SDK then sends all). */
export function activeToolNames(sessionId: string, allNames: readonly string[]): string[] | undefined {
  const state = sessions.get(sessionId);
  if (!state) return undefined;
  return allNames.filter((name) => !state.deferred.has(name) || state.loaded.has(name));
}

export function forgetToolSearch(sessionId: string): void {
  sessions.delete(sessionId);
}

function catalogLine(entry: DeferredToolEntry): string {
  const firstLine = entry.description.split('\n')[0]?.trim() ?? '';
  const short = firstLine.length > CATALOG_DESCRIPTION_CHARS ? `${firstLine.slice(0, CATALOG_DESCRIPTION_CHARS - 1)}…` : firstLine;
  return `- ${entry.name} (${entry.serverName}: ${entry.toolName})${short ? `: ${short}` : ''}`;
}

export function toolSearchDescription(catalog: readonly DeferredToolEntry[]): string {
  return [
    `Finds and loads deferred workspace MCP tools. ${catalog.length} tools are deferred to keep the context small; they cannot be called until loaded here.`,
    'Pass "select:name1,name2" for exact names, or keywords matched against the name, the server and the description.',
    'Returns the full definitions of the matches and makes them callable from your next step for the rest of this session.',
    '',
    'Deferred tools:',
    ...catalog.map(catalogLine),
  ].join('\n');
}

/** The `tool_search` tool for one session over its deferred catalog. */
export function buildToolSearchTool(sessionId: string, catalog: readonly DeferredToolEntry[]): Tool {
  return tool({
    description: toolSearchDescription(catalog),
    inputSchema: jsonSchema<{ query: string; max_results?: number }>({
      type: 'object',
      properties: {
        query: { type: 'string', description: '"select:name1,name2" for exact names, or keywords' },
        max_results: { type: 'number', description: `At most this many keyword matches (default ${DEFAULT_MAX_RESULTS}, up to ${MAX_RESULTS_CAP})` },
      },
      required: ['query'],
      additionalProperties: false,
    }),
    execute: async ({ query, max_results }) => {
      const { matches, unknown } = searchDeferredTools(typeof query === 'string' ? query : '', catalog, typeof max_results === 'number' ? max_results : DEFAULT_MAX_RESULTS);
      loadDeferredTools(sessionId, matches.map((entry) => entry.name));
      return {
        loaded: matches.map((entry) => ({ name: entry.name, server: entry.serverName, description: entry.description, input_schema: entry.inputSchema })),
        ...(unknown.length > 0 ? { unknown } : {}),
        note: matches.length > 0
          ? `${matches.length} tool${matches.length === 1 ? '' : 's'} loaded; call them by name from your next step.`
          : 'No deferred tool matched. Try other keywords, or "select:" with a name from the list in this tool\'s description.',
      };
    },
  });
}
