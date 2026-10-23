import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { splitContextEnvelope, splitHostEvent } from '@prokopai/sdk';
import { createCommandRegistry, type CommandRegistry } from './commands';
import { completionMessage, configureShellCompletions } from './completion';

const dirs: string[] = [];
let registry: CommandRegistry | null = null;

function outputDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'shell-completion-'));
  dirs.push(dir);
  return dir;
}

function start(reg: CommandRegistry, command: string, sessionId = 'session-a') {
  return reg.start({ sessionId, command, argv: ['/bin/sh', '-c', command], cwd: process.cwd(), env: { PATH: process.env.PATH ?? '' }, outputDir: outputDir() });
}

afterEach(() => {
  registry?.shutdown();
  registry = null;
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

describe('shell completion messages', () => {
  test('a finished command becomes a prompt with its output as a terminal chip', async () => {
    registry = createCommandRegistry();
    const record = start(registry, 'echo built; exit 0');
    await registry.wait(record.id, 5000);

    const message = completionMessage(record, registry);
    const { event, body: rest } = splitHostEvent(message);
    expect(event).toMatchObject({ kind: 'shell', id: record.id, label: 'echo built; exit 0', outcome: 'ok' });
    expect(event?.meta).toMatch(/^exit 0 · \d/);
    expect(event?.summary).toContain(`Background command ${record.id} finished successfully after`);
    expect(event?.summary).toContain('`echo built; exit 0`');
    const { body, terminals } = splitContextEnvelope(rest);
    expect(body).toContain(`[echo built; exit 0](#context-${record.id})`);
    expect(body).toContain(`Full output: ${record.outputPath}`);
    const chip = terminals.get(record.id);
    expect(chip).toMatchObject({ kind: 'terminal', label: 'echo built; exit 0', cwd: process.cwd(), text: 'built' });
  });

  test('failures, kills and start errors read as such', async () => {
    registry = createCommandRegistry();
    const failed = start(registry, 'exit 7');
    await registry.wait(failed.id, 5000);
    expect(splitHostEvent(completionMessage(failed, registry)).event).toMatchObject({ outcome: 'error', meta: expect.stringMatching(/^exit 7 · /),
      summary: expect.stringContaining('exited with code 7') });

    const killed = start(registry, 'sleep 30');
    await registry.wait(killed.id, 50);
    await registry.kill(killed.id);
    expect(splitHostEvent(completionMessage(killed, registry)).event).toMatchObject({ outcome: 'stopped', meta: expect.stringMatching(/^killed · /),
      summary: expect.stringContaining('was killed') });

    const broken = registry.start({ sessionId: 's', command: 'x', argv: ['/no/such/shell', '-c', 'x'], cwd: process.cwd(), env: {}, outputDir: outputDir() });
    await registry.wait(broken.id, 5000);
    expect(splitHostEvent(completionMessage(broken, registry)).event).toMatchObject({ outcome: 'error', summary: expect.stringContaining('could not start') });
  });
});

describe('completion delivery', () => {
  test('only commands the tool left running are delivered, to their session', async () => {
    registry = createCommandRegistry();
    const delivered: Array<{ sessionId: string; content: string }> = [];
    configureShellCompletions({ deliver: async (sessionId, content) => { delivered.push({ sessionId, content }); } }, registry);

    const quick = start(registry, 'true', 'session-a');
    const slow = start(registry, 'sleep 0.2; echo late', 'session-b');
    registry.detach(slow.id);
    await Promise.all([registry.wait(quick.id, 5000), registry.wait(slow.id, 5000)]);
    await Bun.sleep(10);

    expect(delivered).toHaveLength(1);
    expect(delivered[0].sessionId).toBe('session-b');
    expect(delivered[0].content).toContain(`Background command ${slow.id} finished successfully`);
    expect(delivered[0].content).toContain('late');

    // A killed command produces no note, whoever killed it.
    const killed = start(registry, 'sleep 30', 'session-b');
    registry.detach(killed.id);
    await registry.wait(killed.id, 50);
    await registry.killForSession('session-b');
    await Bun.sleep(10);
    expect(delivered).toHaveLength(1);

    configureShellCompletions(null, registry);
    const afterClear = start(registry, 'true', 'session-b');
    registry.detach(afterClear.id);
    await registry.wait(afterClear.id, 5000);
    await Bun.sleep(10);
    expect(delivered).toHaveLength(1);
  });

  test('a delivery failure is logged, not thrown into the registry', async () => {
    registry = createCommandRegistry();
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { errors.push(args); };
    try {
      configureShellCompletions({ deliver: async () => { throw new Error('no session'); } }, registry);
      const record = start(registry, 'true');
      registry.detach(record.id);
      await registry.wait(record.id, 5000);
      await Bun.sleep(10);
      expect(errors).toHaveLength(1);
      expect(String(errors[0])).toContain('completion delivery failed');
    } finally {
      console.error = original;
      configureShellCompletions(null, registry);
    }
  });
});
