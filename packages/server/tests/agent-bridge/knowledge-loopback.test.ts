import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prokopCompatibilityBindings } from '@/adapters/prokop/runtime-host/bindings';
import { executeMemoryTool } from '@/harnesses/shared/memory/memory-tool';
import { executeSkillManageTool } from '@/harnesses/shared/skills/skill-manage-tool';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { createManagedWorktreeRepository } from '@/infrastructure/sqlite/managed-worktrees';
import { getRuntimeHost } from '@prokopai/core/infrastructure/runtime/host';
import { getHostLayout } from '@prokopai/core/infrastructure/runtime/host-layout';
import { resetTestDatabase, restoreConfiguredRuntime, setupTestDatabase } from '#tests/db';
import { seedWorkspace } from '#tests/seed';

/** Production wiring with PROKOPAI_AGENT_LOOPBACK=1 for knowledge: writes and layout. */
describe('knowledge over the agent protocol loopback (SQLite)', () => {
  const dirs: string[] = [];
  const tempDir = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-knowledge-'));
    dirs.push(dir);
    return dir;
  };
  let workspaceCount = 0;
  /** A registered workspace: the host only writes knowledge into known workspace or agent dirs. */
  const workspace = (): { memory: string; skills: string } => {
    const path = tempDir();
    seedWorkspace({ id: `ws-k${++workspaceCount}`, path });
    return { memory: join(path, '.prokopai'), skills: join(path, '.agents', 'skills') };
  };

  beforeEach(() => {
    process.env.PROKOPAI_AGENT_LOOPBACK = '1';
    setupTestDatabase();
  });

  afterEach(() => {
    delete process.env.PROKOPAI_AGENT_LOOPBACK;
    restoreConfiguredRuntime();
    resetTestDatabase();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  test('approved memory writes go through the host and match a local write', async () => {
    const viaProtocol = workspace().memory;
    const local = tempDir();
    const input = { action: 'add', target: 'memory', content: 'Run tests with env -i.' };

    const remote = await executeMemoryTool(input, viaProtocol, 'none');
    const direct = await executeMemoryTool(input, local, 'none', undefined, { local: true });

    expect(remote).toEqual(direct);
    expect(remote.success).toBe(true);
    expect(readFileSync(join(viaProtocol, 'MEMORY.md'), 'utf8')).toBe(readFileSync(join(local, 'MEMORY.md'), 'utf8'));
  });

  test('the host refuses writes outside workspace and agent knowledge dirs', async () => {
    const elsewhere = tempDir();
    await expect(executeMemoryTool({ action: 'add', target: 'memory', content: 'x' }, elsewhere, 'none'))
      .rejects.toThrow('Not a workspace or agent knowledge directory');
    const { memory } = workspace();
    await expect(executeSkillManageTool({ action: 'create', name: 'x', description: 'd', content: 'c' }, memory, 'none'))
      .rejects.toThrow('Not a workspace or agent knowledge directory');
    expect(existsSync(join(elsewhere, 'MEMORY.md'))).toBe(false);
  });

  test('a rejected ask never reaches the host', async () => {
    const dir = tempDir();
    const result = await executeMemoryTool({ action: 'add', target: 'user', content: 'x' }, dir, 'medium', async () => false);
    expect(result).toEqual({ success: false, error: 'USER_REJECTION' });
  });

  test('approved skill writes go through the host and match a local write', async () => {
    const viaProtocol = workspace().skills;
    const local = tempDir();
    const input = { action: 'create', name: 'release-check', description: 'Check releases.', content: 'Steps.' };
    const remote = await executeSkillManageTool(input, viaProtocol, 'none');
    const direct = await executeSkillManageTool(input, local, 'none', undefined, { local: true });
    expect(remote).toEqual(direct);
    expect(readFileSync(join(viaProtocol, 'release-check', 'SKILL.md'), 'utf8'))
      .toBe(readFileSync(join(local, 'release-check', 'SKILL.md'), 'utf8'));
  });

  test('a managed worktree shares its workspace memory and skills dirs once its root is resolved', async () => {
    const workspacePath = tempDir();
    const worktreePath = tempDir();
    mkdirSync(join(workspacePath, '.prokopai'), { recursive: true });
    seedWorkspace({ id: 'ws1', path: workspacePath });
    createManagedWorktreeRepository(getDatabase).create({
      id: 'wt1', name: 'feature', workspaceId: 'ws1', repositoryId: 'r1', repositoryRoot: join(workspacePath, '.git'),
      path: worktreePath, branch: 'feature', head: 'abc', state: 'available',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const resolved = await getRuntimeHost().workspace.resolveSessionWorkspace!({
      sessionId: 's1', workspaceId: 'ws1', workspaceRootId: 'wt1', workspacePath,
    });
    expect(resolved.workspacePath).toBe(worktreePath);

    const expected = prokopCompatibilityBindings.layout;
    expect(getHostLayout().workspaceMemoryDir(worktreePath)).toBe(expected.workspaceMemoryDir(worktreePath));
    expect(getHostLayout().workspaceSkillsDir(worktreePath)).toBe(expected.workspaceSkillsDir(worktreePath));
    expect(getHostLayout().workspaceSkillsDir(worktreePath)).toBe(join(workspacePath, '.agents', 'skills'));
  });
});
