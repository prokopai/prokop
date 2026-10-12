/**
 * How-to: review what the agent changed and commit it. The finished fix has
 * two uncommitted files; open Changes, preview a diff, commit both, and see
 * the commit at the top of Branches.
 */
import { clickOn, ScreenRecorder, showCursor, type Clip } from '../clip';
import { openWorkspace } from '../scene';
import { FIX_READY } from '../scenes/ready';

const MESSAGE = 'Return 410 for expired links';

export const guideReviewCommit: Clip = {
  name: 'guide-review-commit',
  live: [],
  async record(ctx, theme, framesDir) {
    const page = await openWorkspace(ctx, theme, {
      columns: [[ctx.world.sessions.fixExpiredLinks!]],
      rightActive: 'explorer',
      docks: { right: true },
      readyTexts: [FIX_READY],
    });
    await showCursor(page);
    const recorder = await ScreenRecorder.start(page, framesDir);
    await page.waitForTimeout(1200);

    // The files the agent edited, then one of their diffs.
    await clickOn(page, page.getByRole('tab', { name: 'Changes' }).first());
    const file = page.locator('[data-item-path="src/routes/redirect.ts"]').filter({ visible: true }).first();
    await clickOn(page, file);
    await page.getByRole('dialog').getByText('Link expired').first().waitFor();
    await page.mouse.move(700, 820, { steps: 20 });
    await page.waitForTimeout(3000);
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.waitForTimeout(500);

    // Commit both files.
    await clickOn(page, page.getByRole('button', { name: 'Commit…' }));
    await clickOn(page, page.getByRole('checkbox', { name: 'Select all matching files' }));
    await clickOn(page, page.getByRole('textbox', { name: 'Commit message' }));
    await page.keyboard.type(MESSAGE, { delay: 40 });
    await page.waitForTimeout(500);
    await clickOn(page, page.getByRole('button', { name: 'Commit', exact: true }));
    await page.getByText(/Committed [0-9a-f]{8}/).first().waitFor();
    await page.waitForTimeout(1500);

    // The new commit on top of the branch history.
    await clickOn(page, page.getByRole('tab', { name: 'Branches' }).first());
    await page.getByText(MESSAGE).first().waitFor();
    await page.mouse.move(1150, 600, { steps: 20 });
    await page.waitForTimeout(3000);
    return { page, recorder };
  },
};
