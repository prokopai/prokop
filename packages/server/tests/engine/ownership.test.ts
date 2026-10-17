import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { isWithin, parseImports, resolveLocalSpecifier, scanDirectory } from '#tests/helpers/import-scan';

const repositoryRoot = resolve(import.meta.dir, '../../../..');
const sourceRoot = resolve(repositoryRoot, 'packages/server/src');
// Shared runtime core (packages/core, host/agent split phase 2.5c).
const coreRoot = resolve(repositoryRoot, 'packages/core/src');
// Harnesses live in the agent package (host/agent split phase 2.5d) and import each other as `#agent/...`.
const agentRoot = resolve(repositoryRoot, 'packages/agent/src');
const prokopRoot = resolve(agentRoot, 'harnesses/prokop');
const kernelRoot = resolve(prokopRoot, 'composition/kernel');

function targetOf(specifier: string, from: string): string | null {
  if (specifier.startsWith('#agent/')) return resolve(agentRoot, specifier.slice('#agent/'.length));
  return resolveLocalSpecifier(specifier, from, sourceRoot);
}

function importsUnder(directory: string): Array<{ file: string; specifier: string; target: string | null }> {
  if (!existsSync(directory)) return [];
  const base = isWithin(directory, agentRoot) ? agentRoot : sourceRoot;
  return scanDirectory(directory).filter(file => !file.path.endsWith('.test.ts')).flatMap(file =>
    parseImports(file.sourceText, file.path).map(imp => ({
      file: relative(base, file.path),
      specifier: imp.specifier,
      target: targetOf(imp.specifier, file.path),
    })));
}

describe('server-owned engine boundaries', () => {
  test('the runtime is no longer a workspace or a package dependency', () => {
    expect(existsSync(resolve(repositoryRoot, 'packages/runtime/package.json'))).toBe(false);
    const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, 'packages/server/package.json'), 'utf8'));
    expect(manifest.dependencies['@prokopai/runtime']).toBeUndefined();
    // Provider adapters live in the runtime core; the host declares only what it imports itself.
    const core = JSON.parse(readFileSync(resolve(repositoryRoot, 'packages/core/package.json'), 'utf8'));
    for (const dependency of ['ai', '@ai-sdk/anthropic', '@ai-sdk/openai', '@ai-sdk/openai-compatible', '@openrouter/ai-sdk-provider']) {
      expect(typeof core.dependencies[dependency]).toBe('string');
    }
    const retired = ['@prokopai', 'runtime'].join('/');
    const imports = scanDirectory(resolve(repositoryRoot, 'packages')).flatMap(file => parseImports(file.sourceText, file.path));
    expect(imports.filter(imp => imp.specifier === retired || imp.specifier.startsWith(retired + '/'))).toEqual([]);
  });

  test('shared services and the other harnesses never import Prokop execution', () => {
    const directories = [
      'infrastructure/providers', 'infrastructure/tools', 'infrastructure/storage',
      'infrastructure/runtime', 'infrastructure/sandbox', 'infrastructure/filesystem', 'harnesses/shared',
      'harnesses/codex-cli', 'harnesses/claude-cli',
    ];
    for (const directory of directories) {
      // Shared services moved to packages/core and the harnesses to packages/agent keep their folders there.
      const imports = [...importsUnder(resolve(sourceRoot, directory)), ...importsUnder(resolve(coreRoot, directory)),
        ...importsUnder(resolve(agentRoot, directory))];
      expect(imports.length).toBeGreaterThan(0);
      expect(imports.filter(imp => imp.target && isWithin(imp.target, prokopRoot))).toEqual([]);
    }
  });

  test('SDK remains independent of the server and execution engine', () => {
    const contracts = resolve(repositoryRoot, 'packages/sdk');
    const manifest = JSON.parse(readFileSync(resolve(contracts, 'package.json'), 'utf8'));
    expect(manifest.dependencies ?? {}).toEqual({});
    const violations = scanDirectory(resolve(contracts, 'src')).flatMap(file =>
      parseImports(file.sourceText, file.path).filter(imp => {
        const target = resolveLocalSpecifier(imp.specifier, file.path, sourceRoot);
        return target ? !isWithin(target, contracts) : !imp.specifier.startsWith('node:');
      }));
    expect(violations).toEqual([]);
  });

  test('the composition kernel is self-contained', () => {
    const imports = importsUnder(kernelRoot);
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter(imp => !imp.target || !isWithin(imp.target, kernelRoot))).toEqual([]);
  });

  test('execution consumes contributed domains without importing their implementations', () => {
    const forbidden = ['goals', 'subagent', 'composition/plugins'].map(dir => resolve(prokopRoot, dir));
    forbidden.push(resolve(agentRoot, 'harnesses/shared'));
    const violations = importsUnder(resolve(prokopRoot, 'execution')).filter(imp => {
      if (imp.file === 'harnesses/prokop/execution/chat-handler.ts' && imp.specifier === '#agent/harnesses/prokop/goals/service') return false;
      if (imp.file === 'harnesses/prokop/execution/agent.ts' && imp.specifier === '#agent/harnesses/prokop/subagent/policy') return false;
      return imp.target && forbidden.some(dir => isWithin(imp.target!, dir));
    });
    expect(violations).toEqual([]);
  });

  test('execution builds context through the assembler and keeps mandatory guards', () => {
    const pins: Record<string, string[]> = {
      'execution/agent.ts': ['getContextAssembler'],
      'retry/stream-chat.ts': ['policyCanRetry', '!attemptHadToolActivity', '!abortController.signal.aborted'],
      'compaction/executor.ts': ['session.compacting'],
      'permission/runtime.ts': ['isValidPermissionResponse(response)', "'denied',", 'persistCanonicalGrants'],
      'tool-output/policy.ts': ['retrieveToolOutputForSession'],
    };
    for (const [file, needles] of Object.entries(pins)) {
      const source = readFileSync(resolve(prokopRoot, file), 'utf8');
      for (const needle of needles) expect(source).toContain(needle);
    }
    expect(importsUnder(resolve(prokopRoot, 'execution')).filter(imp => imp.specifier.includes('system-message'))).toEqual([]);
  });
});
