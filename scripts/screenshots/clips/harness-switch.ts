/**
 * One conversation across two runtimes. Claude Code adds tests for overdue
 * invoices; then the session is switched to Codex from the model picker, the
 * way you would when Claude Code runs out of usage, and Codex continues the
 * same conversation from the handoff summary. Both turns are real CLI runs on
 * real models, so wording and timing differ per recording. Waits where
 * nothing on screen changes are cut.
 */
import { clickOn, sendPrompt, showCursor, ScreenRecorder, type Clip } from '../clip';
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

    // Switch from the model picker: Model, then the OpenAI tab, then a Codex model.
    await clickOn(page, page.getByRole('combobox', { name: /^Model and configuration/ }).filter({ visible: true }).first());
    await page.waitForTimeout(500);
    await clickOn(page, page.getByRole('button', { name: /^Model\b/ }).filter({ visible: true }).first());
    await page.waitForTimeout(400);
    await clickOn(page, page.getByRole('tab', { name: 'OpenAI' }));
    await page.waitForTimeout(600);
    await clickOn(page, page.getByRole('option').filter({ hasText: codexModel.name }).first());
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
