import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeTaskOutputRoot, harnessSkillRoots } from '@prokopai/agent/internal/harnesses/shared/permission-roots';
import { classifyClaudeTool } from '@prokopai/agent/internal/harnesses/claude-cli/tool-policy';

let home: string;
beforeEach(() => { home = realpathSync(mkdtempSync(join(tmpdir(), 'skill-roots-'))); });
afterEach(() => rmSync(home, { recursive: true, force: true }));

test('skill roots are the harness skill and plugin folders, never the whole homes', () => {
  expect(harnessSkillRoots('/home/u', {})).toEqual(['/home/u/.claude/skills', '/home/u/.claude/plugins',
    '/home/u/.codex/skills', '/home/u/.codex/plugins', '/home/u/.agents/skills']);
  expect(harnessSkillRoots('/home/u', { CLAUDE_CONFIG_DIR: '/cfg/claude', CODEX_HOME: '/cfg/codex' }))
    .toEqual(['/cfg/claude/skills', '/cfg/claude/plugins', '/cfg/codex/skills', '/cfg/codex/plugins', '/home/u/.agents/skills']);
});

test('built-in skills read without an ask; credentials, history and skill writes still ask', () => {
  const root = join(home, 'project');
  for (const dir of [root, join(home, '.codex/skills/.system/imagegen'), join(home, '.claude/skills/x')]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(home, '.codex/skills/.system/imagegen/SKILL.md'), 'skill');
  writeFileSync(join(home, '.codex/auth.json'), '{}');
  // A skill folder link pointing at credentials is judged by its target.
  symlinkSync(join(home, '.codex/auth.json'), join(home, '.claude/skills/x/leak.json'));
  const allowed = { roots: [root], readRoots: harnessSkillRoots(home, {}) };
  expect(classifyClaudeTool('Read', { file_path: join(home, '.codex/skills/.system/imagegen/SKILL.md') }, root, allowed)).toBeUndefined();
  expect(classifyClaudeTool('Bash', { command: `cat ${join(home, '.codex/skills/.system/imagegen/SKILL.md')}` }, root, allowed)).toBeUndefined();
  expect(classifyClaudeTool('Read', { file_path: join(home, '.codex/auth.json') }, root, allowed)).toMatchObject({ concerns: ['escape'] });
  expect(classifyClaudeTool('Read', { file_path: join(home, '.codex/history.jsonl') }, root, allowed)).toMatchObject({ concerns: ['escape'] });
  expect(classifyClaudeTool('Write', { file_path: join(home, '.claude/skills/x/SKILL.md'), content: 'x' }, root, allowed))
    .toMatchObject({ concerns: ['escape'] });
  expect(classifyClaudeTool('Read', { file_path: join(home, '.claude/skills/x/leak.json') }, root, allowed)).toMatchObject({ concerns: ['escape'] });
});

test('Claude task outputs read without an ask; writing there or reading a neighbour still asks', () => {
  const root = join(home, 'project');
  const outputs = join(home, 'claude-501', '-Users-u-project', 'session', 'tasks');
  mkdirSync(root, { recursive: true });
  mkdirSync(outputs, { recursive: true });
  mkdirSync(join(home, 'claude-502'), { recursive: true });
  writeFileSync(join(outputs, 'bvpze7c7j.output'), 'build ok');
  const allowed = { roots: [root], readRoots: [join(home, 'claude-501')] };
  expect(classifyClaudeTool('Bash', { command: `cat ${join(outputs, 'bvpze7c7j.output')} | tail -5; echo` }, root, allowed)).toBeUndefined();
  expect(classifyClaudeTool('Read', { file_path: join(outputs, 'bvpze7c7j.output') }, root, allowed)).toBeUndefined();
  expect(classifyClaudeTool('Bash', { command: `echo x > ${join(outputs, 'bvpze7c7j.output')}` }, root, allowed))
    .toMatchObject({ concerns: ['escape'] });
  expect(classifyClaudeTool('Bash', { command: `cat ${join(home, 'claude-502', 'x.output')}` }, root, allowed))
    .toMatchObject({ concerns: ['escape'] });
});

test('the Claude task folder counts only as a private directory owned by this user', () => {
  const info = (overrides: Partial<{ dir: boolean; link: boolean; uid: number; mode: number }> = {}) => () => ({
    isDirectory: () => overrides.dir ?? true,
    isSymbolicLink: () => overrides.link ?? false,
    uid: overrides.uid ?? 501,
    mode: overrides.mode ?? 0o40700,
  }) as unknown as import('node:fs').Stats;
  expect(claudeTaskOutputRoot(501, 'darwin', info())).toBe('/tmp/claude-501');
  expect(claudeTaskOutputRoot(501, 'linux', info())).toBe('/tmp/claude-501');
  expect(claudeTaskOutputRoot(501, 'win32', info())).toBeNull();
  expect(claudeTaskOutputRoot(501, 'linux', info({ link: true }))).toBeNull();
  expect(claudeTaskOutputRoot(501, 'linux', info({ dir: false }))).toBeNull();
  expect(claudeTaskOutputRoot(501, 'linux', info({ uid: 0 }))).toBeNull();
  expect(claudeTaskOutputRoot(501, 'linux', info({ mode: 0o40777 }))).toBeNull();
  expect(claudeTaskOutputRoot(501, 'linux', () => { throw new Error('ENOENT'); })).toBeNull();
});
