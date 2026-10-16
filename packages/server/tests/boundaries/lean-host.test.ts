import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { isWithin, parseImports } from '#tests/helpers/import-scan';

/*
 * Lean host gate: what the host evaluates at startup. Bun evaluates every
 * static import, so the host's static graph from its entry decides its idle
 * memory. Lazy edges (dynamic import, require) load on use: the agent runtime
 * (`bootstrap/agent-runtime.ts`) or a first MCP connection.
 */

const repositoryRoot = resolve(import.meta.dir, '../../../..');
const serverSource = resolve(repositoryRoot, 'packages/server/src');
const coreSource = resolve(repositoryRoot, 'packages/core/src');
const agentSource = resolve(repositoryRoot, 'packages/agent/src');
const coreExports = JSON.parse(readFileSync(resolve(repositoryRoot, 'packages/core/package.json'), 'utf8')).exports as
  Record<string, string>;

/** Packages only the agent runtime (or a model call) needs. */
const heavyPackages = [
  'ai', '@ai-sdk/', '@openrouter/ai-sdk-provider', '@anthropic-ai/claude-agent-sdk', '@modelcontextprotocol/sdk',
  'xlsx', 'pdfjs-dist', 'mammoth', 'turndown', 'adm-zip',
];

function tsFile(base: string): string | null {
  for (const candidate of [`${base}.ts`, join(base, 'index.ts')]) if (existsSync(candidate)) return candidate;
  return null;
}

function resolveSpecifier(specifier: string, from: string): string | null {
  if (specifier.startsWith('@/') && isWithin(from, serverSource)) return tsFile(join(serverSource, specifier.slice(2)));
  if (specifier.startsWith('#agent/')) return tsFile(join(agentSource, specifier.slice('#agent/'.length)));
  if (specifier === '@prokopai/agent') return join(agentSource, 'index.ts');
  if (specifier.startsWith('@prokopai/agent/')) {
    const sub = specifier.slice('@prokopai/agent/'.length);
    return tsFile(join(agentSource, sub.startsWith('internal/') ? sub.slice('internal/'.length) : sub));
  }
  if (specifier.startsWith('@prokopai/core/')) {
    const exported = coreExports[`./${specifier.slice('@prokopai/core/'.length)}`];
    return exported ? resolve(repositoryRoot, 'packages/core', exported) : tsFile(join(coreSource, specifier.slice('@prokopai/core/'.length)));
  }
  if (specifier.startsWith('.')) return tsFile(resolve(dirname(from), specifier));
  return null;
}

/** Files and npm packages evaluated when `entry` loads (static edges only). */
function staticGraph(entry: string): { files: Set<string>; packages: Map<string, string> } {
  const files = new Set([entry]);
  const packages = new Map<string, string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    for (const imp of parseImports(readFileSync(file, 'utf8'), file)) {
      if (imp.kind !== 'value' && imp.kind !== 'side-effect' && imp.kind !== 'export-from') continue;
      const target = resolveSpecifier(imp.specifier, file);
      if (target) {
        if (!files.has(target)) {
          files.add(target);
          queue.push(target);
        }
      } else if (!imp.specifier.startsWith('.') && !imp.specifier.startsWith('node:') && !imp.specifier.startsWith('bun')) {
        packages.set(imp.specifier, relative(repositoryRoot, file));
      }
    }
  }
  return { files, packages };
}

const heavyIn = (packages: Map<string, string>): string[] => [...packages]
  .filter(([specifier]) => heavyPackages.some(name => specifier === name || specifier.startsWith(name.endsWith('/') ? name : `${name}/`)))
  .map(([specifier, file]) => `${file} imports ${specifier}`);

/** Harness runtimes: each loads on its harness's first call. */
const harnessRuntimes = [
  'harnesses/prokop/execution.ts', 'harnesses/prokop/composition/composition.ts', 'harnesses/prokop/tools/index.ts',
  'harnesses/codex-cli/execution.ts', 'harnesses/claude-cli/execution.ts',
];

describe('2.6 gate: lean host', () => {
  test('the light agent entry loads no heavy package and no agent runtime', () => {
    const { files, packages } = staticGraph(join(agentSource, 'host.ts'));
    expect(heavyIn(packages)).toEqual([]);
    expect(files.has(join(agentSource, 'index.ts'))).toBe(false);
    expect(harnessRuntimes.filter(file => files.has(join(agentSource, file)))).toEqual([]);
  });

  test('the host entry evaluates no agent runtime and no heavy package at startup', () => {
    const light = staticGraph(join(agentSource, 'host.ts')).files;
    const { files, packages } = staticGraph(join(serverSource, 'index.ts'));
    const agentFiles = [...files].filter(file => isWithin(file, agentSource) && !light.has(file));
    expect(agentFiles.map(file => relative(repositoryRoot, file))).toEqual([]);
    expect(heavyIn(packages)).toEqual([]);
  });
});

describe('2.6b gate: lazy agent', () => {
  test('the harness registrations load no harness runtime and no heavy package until first use', () => {
    const { files, packages } = staticGraph(join(agentSource, 'composition/harness-registrations.ts'));
    expect(heavyIn(packages)).toEqual([]);
    expect(harnessRuntimes.filter(file => files.has(join(agentSource, file)))).toEqual([]);
  });
});
