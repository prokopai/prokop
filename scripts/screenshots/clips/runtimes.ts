/**
 * One agent on two runtimes, side by side in invoicer. On Claude Code it is
 * told once not to mock Date and saves that to its own memory; on Codex it
 * is asked for tests and applies it. Both turns are real CLI runs on real
 * models, nothing is scripted, so wording and timing differ per recording.
 * Waits where nothing on screen changes, mostly a model thinking, are cut.
 */
import type { Page } from 'playwright-core';
import { sendPrompt, ScreenRecorder, type Clip, type ClipContext } from '../clip';
import { openWorkspace } from '../scene';

const PREFERENCE = "One thing for the future: don't mock Date in tests. Pass `now` in as a parameter instead. That's how I do it in every project.";
const TESTS = 'Add tests for overdue invoices.';

export async function createCliSession(ctx: ClipContext, harness: 'claude-cli' | 'codex-cli', title: string): Promise<string> {
  const workspaceId = ctx.world.invoicerWorkspaceId;
  if (!workspaceId) throw new Error('The runtimes clip needs the invoicer workspace');
  const { session } = await ctx.demo.rest.sessions.create({ workspaceId, title, harness, preconfigId: ctx.world.agentId });
  const sessions = ctx.demo.rest.sessions;
  const catalog = harness === 'claude-cli' ? await sessions.claudeCatalog() : await sessions.codexCatalog();
  const model = catalog.models.find((entry) => entry.isDefault) ?? catalog.models[0];
  if (!model) throw new Error(`No ${harness} models; is the CLI installed and logged in?`);
  const selection = { model: model.model, effort: 'low' };
  if (harness === 'claude-cli') await sessions.setClaudeModel(session.id, selection);
  else await sessions.setCodexModel(session.id, selection);
  return session.id;
}

async function running(ctx: ClipContext, sessionId: string): Promise<boolean> {
  const { session } = await ctx.demo.rest.sessions.get(sessionId);
  if (session.runningAt) return true;
  const { messages } = await ctx.demo.rest.sessions.listMessages(sessionId);
  const last = messages.at(-1);
  if (last?.role === 'assistant' && last.status === 'error') throw new Error(`Turn failed: ${last.error ?? 'unknown error'}`);
  return false;
}

/**
 * Waits for the session's turn to end, recording only while the page text
 * changes (digits aside, so elapsed timers do not count as activity).
 */
export async function recordTurn(ctx: ClipContext, page: Page, recorder: ScreenRecorder, sessionId: string, idleMs = 2500, timeoutMs = 300_000): Promise<void> {
  const text = () => page.evaluate(() => document.body.innerText.replace(/\d+/g, '#'));
  const deadline = Date.now() + timeoutMs;
  let last = await text();
  let changedAt = Date.now();
  // The turn may not have registered as running yet right after sending.
  await page.waitForTimeout(1500);
  while (await running(ctx, sessionId)) {
    if (Date.now() > deadline) throw new Error(`Turn in ${sessionId} did not finish within ${timeoutMs}ms`);
    // Some runs look for AGENTS.md above the repo, which asks about real host paths. Retake those.
    if (await page.getByText(/^Allow (Claude|Codex) to /).count()) throw new Error('The model raised an approval ask; retake');
    const current = await text();
    if (current !== last) {
      last = current;
      changedAt = Date.now();
      recorder.resume();
    } else if (Date.now() - changedAt > idleMs) {
      recorder.pause();
    }
    await page.waitForTimeout(250);
  }
  recorder.resume();
}

export const runtimesClip: Clip = {
  name: 'runtimes',
  // Neither may run: the preference would already be in the agent's memory.
  live: ['datePreference', 'testInvoices'],
  async record(ctx, theme, framesDir) {
    const claudeId = await createCliSession(ctx, 'claude-cli', 'No Date mocks in tests');
    const codexId = await createCliSession(ctx, 'codex-cli', 'Test overdue invoices');

    // Open with invoicer as the active workspace, where both sessions live.
    const page = await openWorkspace({ ...ctx, world: { workspaceId: ctx.world.invoicerWorkspaceId! } }, theme, {
      columns: [[claudeId], [codexId]],
      readyTexts: ['No Date mocks in tests', 'Test overdue invoices'],
    });
    const recorder = await ScreenRecorder.start(page, framesDir);

    await page.waitForTimeout(1500);
    await sendPrompt(page, PREFERENCE, 0);
    await recordTurn(ctx, page, recorder, claudeId);
    // Time to read that it went into the agent's memory.
    await page.waitForTimeout(3000);

    await sendPrompt(page, TESTS, 1);
    await recordTurn(ctx, page, recorder, codexId);
    await page.waitForTimeout(4000);
    return { page, recorder };
  },
};
