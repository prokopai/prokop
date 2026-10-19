/**
 * How-to: run a session on your Claude Code login, check plan limits in the
 * Usage tab, then switch the same conversation to Codex. The Claude Code
 * turn is a real CLI run on a real model; waits where nothing on screen
 * changes are cut. The Usage tab shows the host's real plan limits.
 */
import { clickOn, pickModel, sendPrompt, ScreenRecorder, showCursor, type Clip } from '../clip';
import { openWorkspace } from '../scene';
import { FIX_READY } from '../scenes/ready';
import { recordTurn } from './runtimes';

const PROMPT = 'What does this project do? Two sentences.';

export const guideClaudeCodex: Clip = {
  name: 'guide-claude-codex',
  live: [],
  async record(ctx, theme, framesDir) {
    const sessions = ctx.demo.rest.sessions;
    const claude = (await sessions.claudeCatalog()).models;
    const codex = (await sessions.codexCatalog()).models;
    const claudeModel = claude.find((model) => model.isDefault) ?? claude[0];
    const codexModel = codex.find((model) => model.isDefault) ?? codex[0];
    if (!claudeModel || !codexModel) throw new Error('Claude Code and Codex must be installed and logged in');

    const page = await openWorkspace(ctx, theme, {
      columns: [[ctx.world.sessions.fixExpiredLinks!]],
      readyTexts: [FIX_READY],
    });
    await showCursor(page);
    // The demo's placeholder provider key cannot read usage; real installs
    // show a card only for providers you connected. Keep it out of the take.
    await page.evaluate(() => {
      const hide = () => {
        for (const group of document.querySelectorAll<HTMLElement>('[data-slot="settings-group"]')) {
          if (group.textContent?.includes('Could not read usage with the configured API key')) group.style.display = 'none';
        }
      };
      new MutationObserver(hide).observe(document.body, { childList: true, subtree: true });
    });
    const recorder = await ScreenRecorder.start(page, framesDir);
    await page.waitForTimeout(800);

    // A new session, then Claude Code from the model picker.
    await clickOn(page, page.getByRole('button', { name: 'New Chat' }).filter({ visible: true }).first());
    await page.getByText('Start a conversation').first().waitFor();
    await page.waitForTimeout(600);
    await pickModel(page, 'Claude Code', claudeModel.name);
    await page.getByRole('textbox', { name: /^Message Claude CLI/ }).filter({ visible: true }).first().waitFor();
    const sessionId = /\/session\/([^/?#]+)/.exec(page.url())?.[1];
    if (!sessionId) throw new Error(`No session in ${page.url()}`);
    await page.waitForTimeout(800);

    await sendPrompt(page, PROMPT);
    await recordTurn(ctx, page, recorder, sessionId);
    await page.waitForTimeout(2000);

    // Plan limits live in the Usage tab next to Sessions.
    await clickOn(page, page.getByRole('tab', { name: 'Usage' }).first());
    await page.getByText('Loading usage…').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => undefined);
    await page.mouse.move(150, 300, { steps: 20 });
    await page.waitForTimeout(4500);
    await clickOn(page, page.getByRole('tab', { name: 'Sessions' }).first());
    await page.waitForTimeout(800);

    // Out of Claude usage: continue the same conversation on Codex.
    await pickModel(page, 'Codex', codexModel.name);
    await page.getByText(/^Switched to Codex CLI/).first().waitFor({ timeout: 15_000 });
    await page.keyboard.press('Escape');
    await page.mouse.move(900, 860, { steps: 20 });
    await page.waitForTimeout(2500);
    return { page, recorder };
  },
};
