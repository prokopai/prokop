/**
 * The workspace's Memory & Learning settings with memory, skill management,
 * and automatic learning switched on. The switches are flipped but not
 * saved, so the demo never starts learning; the crop leaves out the
 * unsaved-changes bar below.
 */
import { around, openWorkspace, type Scene } from '../scene';
import { FIX_READY } from './ready';

export const settingsLearning: Scene = {
  name: 'settings-learning',
  async open(ctx, theme) {
    const page = await openWorkspace(ctx, theme, {
      columns: [[ctx.world.sessions.fixExpiredLinks]],
      readyTexts: [FIX_READY],
    });
    await page.getByRole('button', { name: /^Settings/ }).click();
    const settings = page.locator('[data-settings-server]');
    await settings.getByRole('navigation').getByText('Memory & Learning', { exact: true }).click();
    for (const name of ['Memory', 'Skill management', 'Automatic learning']) {
      const toggle = settings.getByRole('switch', { name });
      if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click();
    }
    await settings.getByRole('switch', { name: 'Improve skills' }).waitFor();
    return page;
  },
  async clip(page) {
    // The Capabilities and Learning groups, without the learners below them.
    const groups = page.locator('[data-settings-server] [data-slot="settings-group"]');
    const capabilities = await groups.filter({ hasText: 'Skill management' }).first().boundingBox();
    const learning = await groups.filter({ hasText: 'Automatic learning' }).first().boundingBox();
    // A tight pad: the settings nav sits just left, the Learners group just below.
    return around(page, [capabilities, learning], 10);
  },
};
