/**
 * How-to: agents, memory, and learning. The default agent already learns
 * from its own conversations; the workspace gets shared memory, skill
 * management, and its own learning turned on and saved.
 */
import { clickOn, ScreenRecorder, showCursor, type Clip } from '../clip';
import { openWorkspace } from '../scene';
import { FIX_READY } from '../scenes/ready';

export const guideAgentLearning: Clip = {
  name: 'guide-agent-learning',
  live: [],
  async record(ctx, theme, framesDir) {
    const page = await openWorkspace(ctx, theme, {
      columns: [[ctx.world.sessions.fixExpiredLinks!]],
      readyTexts: [FIX_READY],
    });
    await showCursor(page);
    const recorder = await ScreenRecorder.start(page, framesDir);
    await page.waitForTimeout(800);

    await clickOn(page, page.getByRole('button', { name: /^Settings/ }));
    // Settings opens as a workspace tab.
    const settings = page.locator('[data-settings-server]');

    // The agent's own memory and learning, already on.
    await clickOn(page, settings.getByText('Agents', { exact: true }).first());
    await clickOn(page, settings.getByText('ProkopCode', { exact: true }).first());
    await clickOn(page, settings.getByRole('button', { name: /Memory & Learning/ }).last());
    await page.waitForTimeout(2200);

    // Shared memory, skills, and learning for this workspace.
    await clickOn(page, settings.getByText('Memory & Learning', { exact: true }).first());
    await page.waitForTimeout(600);
    await clickOn(page, settings.getByRole('switch', { name: 'Memory' }));
    await clickOn(page, settings.getByRole('switch', { name: 'Skill management' }));
    await clickOn(page, settings.getByRole('switch', { name: 'Automatic learning' }));
    await page.waitForTimeout(900);
    await clickOn(page, settings.getByRole('button', { name: 'Save changes' }));
    await settings.getByRole('button', { name: 'Saved' }).waitFor();
    await page.waitForTimeout(2000);
    return { page, recorder };
  },
};
