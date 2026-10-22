/**
 * `.prokop/worktree.json`: the repository's recipe for making a fresh managed
 * worktree usable (ignored files to copy, directories to clone, env and
 * template files to write, a port block, and setup/teardown commands).
 *
 * Pure: parsing, strict validation, template rendering and the derived names
 * (`slug`, `key`). File access, Git checks and port probing live in the
 * infrastructure adapter; the application use case sequences them.
 *
 * Validation is strict on purpose. The file is committed and read from the
 * primary checkout, so a typo surfaces the first time a worktree is created,
 * not as a half-set-up worktree later.
 */

import { createHash } from 'node:crypto';
import { posix } from 'node:path';

export const DEFAULT_PORT_COUNT = 10;
export const MAX_PORT_COUNT = 20;
export const DEFAULT_ENV_FILE = '.env.worktree';
export const WORKTREE_CONFIG_PATH = '.prokop/worktree.json';

export interface WorktreeSetupConfig {
  /** Size of the port block, or null when the config never uses ports. */
  ports: number | null;
  /** Ignored files copied from the primary checkout into the worktree. */
  copy: string[];
  /** Directories cloned copy-on-write from the primary checkout. */
  clone: string[];
  /** Values written to `envFile` and exported to setup commands. */
  env: Record<string, string>;
  envFile: string;
  /** Files written from templates, keyed by worktree-relative path. */
  files: Record<string, string>;
  setup: string[];
  teardown: string[];
}

export interface WorktreeConfigError {
  ok: false;
  message: string;
}

export interface WorktreeConfigParsed {
  ok: true;
  config: WorktreeSetupConfig;
  /** Stable hash of the file text, the approval key for its commands. */
  hash: string;
}

export type WorktreeConfigResult = WorktreeConfigParsed | WorktreeConfigError;

const KNOWN_KEYS = new Set(['ports', 'copy', 'clone', 'env', 'envFile', 'files', 'setup', 'teardown']);
const SIMPLE_VARIABLES = new Set(['port', 'name', 'slug', 'key', 'id', 'path', 'rootPath']);
const TEMPLATE_PATTERN = /\{\{\s*([^}]*?)\s*\}\}/g;
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function error(message: string): WorktreeConfigError {
  return { ok: false, message: `${WORKTREE_CONFIG_PATH}: ${message}` };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A relative path that stays inside its root after lexical normalization.
 * Returns the normalized path or null. Symlink escapes are the adapter's
 * job (lstat at apply time); this only rejects what the text alone shows.
 */
export function normalizeRelativePath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) return null;
  if (posix.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\')) return null;
  const normalized = posix.normalize(value.replace(/\\/g, '/'));
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.endsWith('/')) {
    return null;
  }
  return normalized;
}

function readPathList(value: unknown, key: string): string[] | WorktreeConfigError {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return error(`"${key}" must be an array of relative paths`);
  const paths: string[] = [];
  for (const entry of value) {
    const normalized = normalizeRelativePath(entry);
    if (!normalized) {
      return error(`"${key}" entry ${JSON.stringify(entry)} must be a relative path inside the repository`);
    }
    paths.push(normalized);
  }
  return paths;
}

function readStringList(value: unknown, key: string): string[] | WorktreeConfigError {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.trim().length === 0)) {
    return error(`"${key}" must be an array of non-empty command strings`);
  }
  return value as string[];
}

/**
 * Lists the variables a template references, with `port+N` offsets kept as
 * `{ offset }`. Unknown names and malformed references are errors.
 */
function templateReferences(template: string, where: string): Array<{ name: string; offset: number }> | WorktreeConfigError {
  const references: Array<{ name: string; offset: number }> = [];
  for (const match of template.matchAll(TEMPLATE_PATTERN)) {
    const expression = match[1] ?? '';
    const offsetMatch = /^port\s*\+\s*(\d+)$/.exec(expression);
    if (offsetMatch) {
      references.push({ name: 'port', offset: Number(offsetMatch[1]) });
      continue;
    }
    if (SIMPLE_VARIABLES.has(expression)) {
      references.push({ name: expression, offset: 0 });
      continue;
    }
    return error(`${where} uses unknown template variable "{{${expression}}}"`);
  }
  return references;
}

export function parseWorktreeSetupConfig(text: string): WorktreeConfigResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause: unknown) {
    return error(`invalid JSON (${cause instanceof Error ? cause.message : 'parse error'})`);
  }
  if (!isPlainObject(raw)) return error('must be a JSON object');
  for (const key of Object.keys(raw)) {
    if (!KNOWN_KEYS.has(key)) return error(`unknown key "${key}"`);
  }

  let ports: number | null = null;
  if (raw.ports !== undefined) {
    if (!Number.isInteger(raw.ports) || (raw.ports as number) < 1 || (raw.ports as number) > MAX_PORT_COUNT) {
      return error(`"ports" must be an integer between 1 and ${MAX_PORT_COUNT}`);
    }
    ports = raw.ports as number;
  }

  const copy = readPathList(raw.copy, 'copy');
  if (!Array.isArray(copy)) return copy;
  const clone = readPathList(raw.clone, 'clone');
  if (!Array.isArray(clone)) return clone;
  const setup = readStringList(raw.setup, 'setup');
  if (!Array.isArray(setup)) return setup;
  const teardown = readStringList(raw.teardown, 'teardown');
  if (!Array.isArray(teardown)) return teardown;

  const env: Record<string, string> = {};
  if (raw.env !== undefined) {
    if (!isPlainObject(raw.env)) return error('"env" must be an object of string values');
    for (const [key, value] of Object.entries(raw.env)) {
      if (!ENV_KEY_PATTERN.test(key)) return error(`"env" key "${key}" is not a valid variable name`);
      if (typeof value !== 'string') return error(`"env.${key}" must be a string`);
      if (/[\r\n]/.test(value)) return error(`"env.${key}" must not contain line breaks`);
      env[key] = value;
    }
  }

  let envFile = DEFAULT_ENV_FILE;
  if (raw.envFile !== undefined) {
    const normalized = normalizeRelativePath(raw.envFile);
    if (!normalized) return error('"envFile" must be a relative path inside the worktree');
    envFile = normalized;
  }

  const files: Record<string, string> = {};
  if (raw.files !== undefined) {
    if (!isPlainObject(raw.files)) return error('"files" must be an object of path to content');
    for (const [key, value] of Object.entries(raw.files)) {
      const normalized = normalizeRelativePath(key);
      if (!normalized) return error(`"files" entry ${JSON.stringify(key)} must be a relative path inside the worktree`);
      if (typeof value !== 'string') return error(`"files.${key}" must be a string`);
      files[normalized] = value;
    }
  }

  // Template references are validated up front so an unknown variable or an
  // offset outside the port block never gets as far as writing a file.
  let usesPort = false;
  let maxOffset = 0;
  const templates: Array<[string, string]> = [
    ...Object.entries(env).map(([key, value]): [string, string] => [`"env.${key}"`, value]),
    ...Object.entries(files).map(([key, value]): [string, string] => [`"files.${key}"`, value]),
  ];
  for (const [where, template] of templates) {
    const references = templateReferences(template, where);
    if (!Array.isArray(references)) return references;
    for (const reference of references) {
      if (reference.name !== 'port') continue;
      usesPort = true;
      maxOffset = Math.max(maxOffset, reference.offset);
    }
  }
  const portCount = ports ?? (usesPort ? DEFAULT_PORT_COUNT : null);
  if (portCount !== null && maxOffset >= portCount) {
    return error(`"{{port+${maxOffset}}}" is outside the port block of ${portCount}`);
  }

  return {
    ok: true,
    config: { ports: portCount, copy, clone, env, envFile, files, setup, teardown },
    hash: createHash('sha256').update(text).digest('hex'),
  };
}

export interface TemplateVariables {
  port: number | null;
  name: string;
  slug: string;
  key: string;
  id: string;
  path: string;
  rootPath: string;
}

/** Renders a template whose references passed `parseWorktreeSetupConfig`. */
export function renderTemplate(template: string, variables: TemplateVariables): string {
  return template.replace(TEMPLATE_PATTERN, (whole, expression: string) => {
    const offsetMatch = /^port\s*\+\s*(\d+)$/.exec(expression);
    if (offsetMatch || expression === 'port') {
      if (variables.port === null) return whole;
      return String(variables.port + (offsetMatch ? Number(offsetMatch[1]) : 0));
    }
    if (SIMPLE_VARIABLES.has(expression)) {
      return String(variables[expression as keyof TemplateVariables]);
    }
    return whole;
  });
}

/**
 * Lowercase letters, digits and single underscores, at most 30 characters.
 * Underscores rather than hyphens: the slug feeds database and topic names,
 * where a hyphen needs quoting.
 */
export function worktreeSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30)
    .replace(/_+$/g, '');
  return slug || 'worktree';
}

/** Slug plus the first six hex characters of the worktree id: unique, readable. */
export function worktreeKey(name: string, worktreeId: string): string {
  const hex = worktreeId.replace(/[^0-9a-f]/gi, '').slice(0, 6).toLowerCase() || '000000';
  return `${worktreeSlug(name)}_${hex}`;
}

/** The `KEY=value` lines written to the env file, one per entry, sorted. */
export function renderEnvFile(env: Record<string, string>, variables: TemplateVariables): string {
  return Object.keys(env)
    .sort()
    .map((key) => `${key}=${renderTemplate(env[key] ?? '', variables)}\n`)
    .join('');
}
