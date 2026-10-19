/**
 * One conversation across two runtimes. Claude Code adds tests for overdue
 * invoices; then the session is switched to Codex from the model picker, the
 * way you would when Claude Code runs out of usage, and Codex continues the
 * same conversation from the handoff summary. Both turns are real CLI runs on
 * real models, so wording and timing differ per recording. Waits where
 * nothing on screen changes are cut.
 */
import { pickModel, sendPrompt, showCursor, ScreenRecorder, type Clip } from '../clip';
import { openWorkspace } from '../scene';
import { createCliSession, recordTurn } from './runtimes';

const TITLE = 'Overdue invoices';
const FIRST = 'Add tests for overdue invoices.';
const SECOND = 'Now add a daysOverdue helper next to isOverdue, with tests.';

export const harnessSwitchClip: Clip = {
  name: 'harness-switch',
  // Invoicer starts without overdue tests, and the agent's memory is empty.
  live: ['datePreference', 'testInvoices'],
  async record(ctx, theme, framesDir) {
    const sessionId = await createCliSession(ctx, 'claude-cli', TITLE);
    const codex = (await ctx.demo.rest.sessions.codexCatalog()).models;
    const codexModel = codex.find((entry) => entry.isDefault) ?? codex[0];
    if (!codexModel) throw new Error('No Codex models; is the CLI installed and logged in?');

    const page = await openWorkspace({ ...ctx, world: { workspaceId: ctx.world.invoicerWorkspaceId! } }, theme, {
      columns: [[sessionId]],
      readyTexts: [TITLE],
    });
    await showCursor(page);
    const recorder = await ScreenRecorder.start(page, framesDir);

    await page.waitForTimeout(1500);
    await sendPrompt(page, FIRST);
    await recordTurn(ctx, page, recorder, sessionId);
    await page.waitForTimeout(2500);

    // Switch from the model chip: the Codex row, then a Codex model.
    await pickModel(page, 'Codex', codexModel.name);
    await page.getByText(/^Switched to Codex CLI/).first().waitFor({ timeout: 15_000 });
    // Like the runtimes clip: low effort keeps the take short. Not visible in the picker label.
    await ctx.demo.rest.sessions.setCodexModel(sessionId, { model: codexModel.model, effort: 'low' });
    await page.waitForTimeout(2500);

    await sendPrompt(page, SECOND);
    await recordTurn(ctx, page, recorder, sessionId);
    await page.waitForTimeout(4000);
    return { page, recorder };
  },
};
