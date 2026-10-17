import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCommandRegistry, type CommandRegistry } from './commands';

// Real `sh` processes: the registry's job is process lifecycle, so a fake
// spawner would only test the fake.

const dirs: string[] = [];
const registries: CommandRegistry[] = [];

function outputDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'shell-commands-'));
  dirs.push(dir);
  return dir;
}

function registry(options: Parameters<typeof createCommandRegistry>[0] = {}): CommandRegistry {
  const created = createCommandRegistry(options);
  registries.push(created);
  return created;
}

function start(reg: CommandRegistry, command: string, sessionId = 'session-a') {
  return reg.start({ sessionId, command, argv: ['/bin/sh', '-c', command], cwd: process.cwd(), env: { PATH: process.env.PATH ?? '' }, outputDir: outputDir() });
}

afterEach(() => {
  for (const reg of registries) reg.shutdown();
  registries.length = 0;
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

describe('command registry', () => {
  test('a quick command completes with its exit code and output', async () => {
    const reg = registry();
    const record = start(reg, 'echo hello; echo oops >&2; exit 3');
    const done = await reg.wait(record.id, 5000);
    expect(done.status).toBe('completed');
    expect(done.exitCode).toBe(3);
    expect(done.endedAt).not.toBeNull();
    const text = reg.tail(record.id, 1024).text;
    expect(text).toContain('hello');
    expect(text).toContain('oops');
    expect(done.lines).toBe(2);
  });

  test('a long command is still running after the window and completes later', async () => {
    const reg = registry();
    const record = start(reg, 'sleep 0.5; echo done');
    const early = await reg.wait(record.id, 50);
    expect(early.status).toBe('running');
    const done = await reg.wait(record.id, 5000);
    expect(done.status).toBe('completed');
    expect(done.exitCode).toBe(0);
    expect(reg.tail(record.id, 1024).text).toBe('done\n');
  });

  test('a backgrounded grandchild holding the pipe does not hold the command', async () => {
    const reg = registry({ closeGraceMs: 200 });
    const startedAt = Date.now();
    const record = start(reg, 'sleep 5 & echo started');
    const done = await reg.wait(record.id, 5000);
    expect(done.status).toBe('completed');
    expect(Date.now() - startedAt).toBeLessThan(2000);
    expect(reg.tail(record.id, 1024).text).toBe('started\n');
  });

  test('kill stops the whole process group and reports killed', async () => {
    const reg = registry();
    const record = start(reg, 'sleep 30 & sleep 30; echo never');
    await reg.wait(record.id, 50);
    const ended = await reg.kill(record.id);
    expect(ended?.status).toBe('killed');
    expect(ended?.signal).toBe('SIGTERM');
    expect(reg.tail(record.id, 1024).text).toBe('');
  });

  test('read pages output by byte cursor', async () => {
    const reg = registry();
    const record = start(reg, 'printf "abcdef"');
    await reg.wait(record.id, 5000);
    const first = reg.read(record.id, 0, 4);
    expect(first).toEqual({ text: 'abcd', cursor: 4, total: 6 });
    const rest = reg.read(record.id, first.cursor, 100);
    expect(rest).toEqual({ text: 'ef', cursor: 6, total: 6 });
  });

  test('tail cuts to a line start when truncated', async () => {
    const reg = registry();
    const record = start(reg, 'printf "first line\\nsecond line\\n"');
    await reg.wait(record.id, 5000);
    const tail = reg.tail(record.id, 15);
    expect(tail.truncated).toBe(true);
    expect(tail.text).toBe('second line\n');
  });

  test('exited commands are pruned per session beyond the limit, files included', async () => {
    const reg = registry({ exitedLimit: 2 });
    const records = [start(reg, 'true'), start(reg, 'true'), start(reg, 'true')];
    // Waiters are registered before any exit: the pruned one still resolves.
    await Promise.all(records.map((record) => reg.wait(record.id, 5000)));
    // The registry may have finished them in any order; two survive.
    const alive = records.filter((record) => reg.get(record.id));
    expect(alive).toHaveLength(2);
    const gone = records.find((record) => !reg.get(record.id))!;
    expect(existsSync(gone.outputPath)).toBe(false);
    expect(alive.every((record) => existsSync(record.outputPath))).toBe(true);
  });

  test('onExit fires once per command and killForSession only touches that session', async () => {
    const reg = registry();
    const exits: string[] = [];
    reg.onExit((record) => exits.push(record.id));
    const mine = start(reg, 'sleep 30', 'session-a');
    const other = start(reg, 'sleep 30', 'session-b');
    await reg.wait(mine.id, 50);
    await reg.killForSession('session-a');
    expect(reg.get(mine.id)?.status).toBe('killed');
    expect(reg.get(other.id)?.status).toBe('running');
    expect(exits).toEqual([mine.id]);
  });

  test('a missing binary reports a start error', async () => {
    const reg = registry();
    const record = reg.start({ sessionId: 's', command: 'nope', argv: ['/definitely/not/a/shell', '-c', 'nope'], cwd: process.cwd(), env: {}, outputDir: outputDir() });
    const done = await reg.wait(record.id, 5000);
    expect(done.status).toBe('completed');
    expect(done.exitCode).toBeNull();
    expect(done.error).toContain('ENOENT');
  });

  test('wait returns early when the signal aborts', async () => {
    const reg = registry();
    const record = start(reg, 'sleep 30');
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    const result = await reg.wait(record.id, 5000, controller.signal);
    expect(result.status).toBe('running');
  });
});
