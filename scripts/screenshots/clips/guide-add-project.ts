/**
 * How-to: add a local project. The invoicer folder exists in ~/code but is
 * not a workspace yet; it is added from the workspace switcher, then its
 * files and a terminal in its directory are shown.
 */
import { clickOn, pointAt, ScreenRecorder, showCursor, type Clip } from '../clip';
import { openWorkspace } from '../scene';
import { FIX_READY } from '../scenes/ready';

export const guideAddProject: Clip = {
  name: 'guide-add-project',
  // The invoicer story needs its workspace, which this clip creates by hand.
  live: ['testInvoices'],
  world: { invoicerWorkspace: false },
  async record(ctx, theme, framesDir) {
    const page = await openWorkspace(ctx, theme, {
      columns: [[ctx.world.sessions.fixExpiredLinks!]],
      readyTexts: [FIX_READY],
    });
    await showCursor(page);
    const recorder = await ScreenRecorder.start(page, framesDir);
    await page.waitForTimeout(800);

    await clickOn(page, page.getByRole('combobox', { name: 'Select workspace' }));
    await clickOn(page, page.getByText('Add existing folder'));
    const picker = page.getByRole('dialog');

    // Into ~/code, then pick the project folder.
    const code = picker.getByRole('button', { name: 'code', exact: true });
    const point = await pointAt(page, code);
    await page.mouse.dblclick(point.x, point.y);
    await page.waitForTimeout(700);
    await clickOn(page, picker.getByRole('button', { name: 'invoicer', exact: true }));
    await clickOn(page, picker.getByRole('button', { name: 'Add Selected Folder' }));
    await page.waitForTimeout(1500);

    // The project's files, and a terminal already in its directory.
    await clickOn(page, page.getByRole('button', { name: 'Show right dock' }));
    await page.waitForTimeout(800);
    await clickOn(page, page.getByRole('button', { name: 'Show bottom dock' }));
    await page.waitForTimeout(1200);
    await clickOn(page, page.locator('.xterm').filter({ visible: true }).first());
    await page.keyboard.type('git log --oneline', { delay: 60 });
    await page.keyboard.press('Enter');
    await page.mouse.move(700, 300, { steps: 20 });
    await page.waitForTimeout(2500);
    return { page, recorder };
  },
};
