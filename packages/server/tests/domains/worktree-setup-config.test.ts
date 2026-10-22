import { describe, expect, test } from 'bun:test';
import {
  parseWorktreeSetupConfig,
  renderEnvFile,
  renderTemplate,
  worktreeKey,
  worktreeSlug,
  type TemplateVariables,
} from '@/domains/worktrees/setup-config';
import { allocatePortBlock, PORT_RANGE_START } from '@/domains/worktrees/port-blocks';

const variables: TemplateVariables = {
  port: 20010,
  name: 'Fix auth flow',
  slug: 'fix_auth_flow',
  key: 'fix_auth_flow_1a2b3c',
  id: '1a2b3c4d-0000-4000-8000-000000000000',
  path: '/data/worktrees/repo/1a2b3c4d',
  rootPath: '/repo',
};

describe('worktree setup config', () => {
  test('parses the documented example with defaults filled in', () => {
    const parsed = parseWorktreeSetupConfig(JSON.stringify({
      ports: 10,
      copy: ['.env', '.env.local', 'config/master.key'],
      clone: ['node_modules'],
      env: { PORT: '{{port}}', API_PORT: '{{port+1}}', DATABASE_NAME: 'app_{{key}}' },
      envFile: '.env.worktree',
      files: { '.env.local': 'PORT={{port}}\nNEXT_PUBLIC_API=http://localhost:{{port+1}}\n' },
      setup: ['bun install', 'bun run db:create'],
      teardown: ['bun run db:drop'],
    }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.config).toEqual({
      ports: 10,
      copy: ['.env', '.env.local', 'config/master.key'],
      clone: ['node_modules'],
      env: { PORT: '{{port}}', API_PORT: '{{port+1}}', DATABASE_NAME: 'app_{{key}}' },
      envFile: '.env.worktree',
      files: { '.env.local': 'PORT={{port}}\nNEXT_PUBLIC_API=http://localhost:{{port+1}}\n' },
      setup: ['bun install', 'bun run db:create'],
      teardown: ['bun run db:drop'],
    });
    expect(parsed.hash).toHaveLength(64);
  });

  test('a config that never mentions ports allocates none; {{port}} alone allocates the default block', () => {
    const noPorts = parseWorktreeSetupConfig('{"copy": [".env"]}');
    expect(noPorts.ok && noPorts.config.ports).toBeNull();
    expect(noPorts.ok && noPorts.config.envFile).toBe('.env.worktree');

    const usesPort = parseWorktreeSetupConfig('{"env": {"PORT": "{{port}}"}}');
    expect(usesPort.ok && usesPort.config.ports).toBe(10);
  });

  test.each([
    ['not json', '{', 'invalid JSON'],
    ['an array', '[]', 'must be a JSON object'],
    ['unknown key', '{"port": 3}', 'unknown key "port"'],
    ['ports too large', '{"ports": 21}', 'between 1 and 20'],
    ['ports not integer', '{"ports": "10"}', 'between 1 and 20'],
    ['absolute copy path', '{"copy": ["/etc/passwd"]}', 'relative path inside the repository'],
    ['escaping copy path', '{"copy": ["../secrets"]}', 'relative path inside the repository'],
    ['nested escape', '{"clone": ["a/../../b"]}', 'relative path inside the repository'],
    ['windows drive', '{"copy": ["C:/x"]}', 'relative path inside the repository'],
    ['env not strings', '{"env": {"PORT": 3}}', '"env.PORT" must be a string'],
    ['env key invalid', '{"env": {"1BAD": "x"}}', 'not a valid variable name'],
    ['env line break', '{"env": {"A": "x\\ny"}}', 'must not contain line breaks'],
    ['envFile escape', '{"envFile": "../x"}', '"envFile" must be a relative path'],
    ['files escape', '{"files": {"../x": "y"}}', 'relative path inside the worktree'],
    ['setup not strings', '{"setup": [1]}', 'array of non-empty command strings'],
    ['unknown variable', '{"files": {"a": "{{nope}}"}}', 'unknown template variable "{{nope}}"'],
    ['offset outside default block', '{"env": {"A": "{{port+10}}"}}', '"{{port+10}}" is outside the port block of 10'],
    ['offset outside explicit block', '{"ports": 2, "env": {"A": "{{port+2}}"}}', 'outside the port block of 2'],
  ])('rejects %s', (_label, text, message) => {
    const parsed = parseWorktreeSetupConfig(text);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toStartWith('.prokop/worktree.json: ');
    expect(parsed.message).toContain(message);
  });

  test('the hash follows the text, not the parsed shape', () => {
    const first = parseWorktreeSetupConfig('{"copy": [".env"]}');
    const second = parseWorktreeSetupConfig('{"copy":[".env"]}');
    expect(first.ok && second.ok && first.hash !== second.hash).toBe(true);
  });

  test('renders every variable and port offsets', () => {
    expect(renderTemplate(
      'p={{port}} p1={{ port+1 }} n={{name}} s={{slug}} k={{key}} i={{id}} w={{path}} r={{rootPath}}',
      variables,
    )).toBe(
      'p=20010 p1=20011 n=Fix auth flow s=fix_auth_flow k=fix_auth_flow_1a2b3c '
      + 'i=1a2b3c4d-0000-4000-8000-000000000000 w=/data/worktrees/repo/1a2b3c4d r=/repo',
    );
  });

  test('writes env entries sorted, one per line', () => {
    expect(renderEnvFile({ PORT: '{{port}}', API_PORT: '{{port+1}}', DB: 'app_{{key}}' }, variables))
      .toBe('API_PORT=20011\nDB=app_fix_auth_flow_1a2b3c\nPORT=20010\n');
  });

  test('slug and key are safe for database names', () => {
    expect(worktreeSlug('Fix auth flow!')).toBe('fix_auth_flow');
    expect(worktreeSlug('---')).toBe('worktree');
    expect(worktreeSlug('a'.repeat(40))).toHaveLength(30);
    expect(worktreeKey('Fix auth flow', '1a2b3c4d-0000-4000-8000-000000000000')).toBe('fix_auth_flow_1a2b3c');
  });
});

describe('port blocks', () => {
  test('takes the lowest aligned block that no record holds and every port passes the probe', async () => {
    const busy = new Set([PORT_RANGE_START + 20, PORT_RANGE_START + 41]);
    const probe = async (port: number): Promise<boolean> => !busy.has(port);
    const held = [{ base: PORT_RANGE_START, count: 10 }, { base: PORT_RANGE_START + 10, count: 10 }];

    // 20000 and 20010 are held, 20020 has a listener, 20030 is free.
    expect(await allocatePortBlock(10, held, probe)).toEqual({ base: PORT_RANGE_START + 30, count: 10 });
    // A block of 5 aligns to 5 and skips the blocks overlapping held ranges.
    expect(await allocatePortBlock(5, held, probe)).toEqual({ base: PORT_RANGE_START + 25, count: 5 });
    // A held block of another size still blocks the candidate it overlaps:
    // 20000 overlaps the held 20010 block, 20020 and 20040 hold listeners.
    expect(await allocatePortBlock(20, [{ base: PORT_RANGE_START + 10, count: 4 }], probe))
      .toEqual({ base: PORT_RANGE_START + 60, count: 20 });
  });

  test('returns null when the range is exhausted', async () => {
    expect(await allocatePortBlock(10, [], async () => false)).toBeNull();
  });
});
