/**
 * How-to: work across projects in Overview. A group brings linkshelf and
 * invoicer into one view; opening a session from each shows the Explorer
 * following the selected session's project.
 */
import { clickOn, ScreenRecorder, showCursor, type Clip } from '../clip';
import { openWorkspace } from '../scene';
import { FIX_READY } from '../scenes/ready';

export const guideOverview: Clip = {
  name: 'guide-overview',
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
    await page.waitForTimeout(800);

    await clickOn(page, page.getByRole('button', { name: 'Overview' }).first());
    await page.waitForTimeout(700);
    await clickOn(page, page.getByRole('combobox', { name: 'Select overview group' }));
    await clickOn(page, page.getByText('Create group').last());

    const name = page.getByRole('dialog').getByLabel('Name');
    await clickOn(page, name);
    await name.pressSequentially('Daily work', { delay: 45 });
    await clickOn(page, page.getByRole('checkbox', { name: 'linkshelf' }));
    await clickOn(page, page.getByRole('checkbox', { name: 'invoicer' }));
    await clickOn(page, page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }));
    await page.waitForTimeout(1200);

    // A session from each project; the Explorer follows the selected one.
    await clickOn(page, page.getByText('Test overdue invoices').first());
    await page.waitForTimeout(1500);
    await clickOn(page, page.getByText('Fix expired links still redire').first());
    await page.waitForTimeout(1500);
    await page.mouse.move(700, 880, { steps: 20 });
    await page.waitForTimeout(1500);
    return { page, recorder };
  },
};
