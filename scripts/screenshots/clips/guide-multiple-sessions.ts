/**
 * How-to: work with several sessions at once. Sessions open as tabs from the
 * sidebar; a tab's context menu splits it right or down.
 */
import { clickOn, ScreenRecorder, showCursor, type Clip } from '../clip';
import { openWorkspace } from '../scene';
import { FIX_READY } from '../scenes/ready';

export const guideMultipleSessions: Clip = {
  name: 'guide-multiple-sessions',
  live: [],
  async record(ctx, theme, framesDir) {
    const page = await openWorkspace(ctx, theme, {
      columns: [[ctx.world.sessions.fixExpiredLinks!]],
      readyTexts: [FIX_READY],
    });
    await showCursor(page);
    const recorder = await ScreenRecorder.start(page, framesDir);
    await page.waitForTimeout(800);

    // Open two more sessions from the sidebar; each becomes a tab.
    await clickOn(page, page.getByText('How are slugs generated?').first());
    await page.waitForTimeout(700);
    await clickOn(page, page.getByText('Rate limit link cr').first());
    await page.waitForTimeout(900);

    // Split the active tab to the right, then another one down.
    await clickOn(page, page.getByRole('tab', { name: /Rate limit link creation/ }), { button: 'right' });
    await clickOn(page, page.getByRole('menuitem', { name: 'Split right' }));
    await page.waitForTimeout(1000);
    await clickOn(page, page.getByRole('tab', { name: /How are slugs generated/ }), { button: 'right' });
    await clickOn(page, page.getByRole('menuitem', { name: 'Split down' }));
    // Park the cursor on empty space so no hover hint covers the result.
    await page.mouse.move(180, 820, { steps: 20 });
    await page.waitForTimeout(2500);
    return { page, recorder };
  },
};
