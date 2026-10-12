import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { harnessSkillRoots } from '@/harnesses/shared/permission-roots';
import { classifyClaudeTool } from '@/harnesses/claude-cli/tool-policy';

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
