/**
 * The group chat, live: the group is opened from the sidebar, Reviewer is
 * picked from the `@` list, the post goes out, Reviewer reads the fix and
 * hands the missing test to Tester, Tester adds it and runs the suite. The
 * members' replies are scripted and paced like every other clip; the real
 * edit and test run happen in the demo repo. Waits where nothing on screen
 * changes are cut.
 */
import type { Page } from 'playwright-core';
import { clickOn, paced, showCursor, ScreenRecorder, type Clip } from '../clip';
import { openWorkspace } from '../scene';
import { FIX_READY } from '../scenes/ready';
import { GROUP_NAME, GROUP_POST, GroupPlay } from '../world/group';

/** Records while the page keeps changing, pausing in the quiet stretches, until `done`. */
async function recordUntil(page: Page, recorder: ScreenRecorder, done: () => Promise<boolean>, idleMs = 2500, timeoutMs = 180_000): Promise<void> {
  const text = () => page.evaluate(() => document.body.innerText.replace(/\d+/g, '#'));
  const deadline = Date.now() + timeoutMs;
  let last = await text();
  let changedAt = Date.now();
  while (!(await done())) {
    if (Date.now() > deadline) throw new Error(`The group conversation did not finish within ${timeoutMs}ms`);
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

const MENTION = '@Reviewer ';
if (!GROUP_POST.startsWith(MENTION)) throw new Error('The group post must open with the Reviewer mention');

export const groupChatClip: Clip = {
  name: 'group-chat',
  // The group reviews the fix the stories made, so every story plays first.
  live: [],
  world: { agents: true },
  async record(ctx, theme, framesDir) {
    const { agents, group } = ctx.world;
    const fix = ctx.world.sessions.fixExpiredLinks;
    if (!agents || !group || !fix) throw new Error('The group clip needs the agents, the group and the expiry fix in the world');
    const play = new GroupPlay(ctx.demo, group, agents, paced);
    await play.start();

    const page = await openWorkspace(ctx, theme, { columns: [[fix]], readyTexts: [FIX_READY] });
    await showCursor(page);
    const recorder = await ScreenRecorder.start(page, framesDir);
    await page.waitForTimeout(1500);

    await clickOn(page, page.getByRole('button', { name: new RegExp(`^${GROUP_NAME}`) }).filter({ visible: true }).first());
    const composer = page.getByRole('textbox', { name: /Message the group/ }).filter({ visible: true }).first();
    await composer.waitFor();
    await page.waitForTimeout(1500);

    // `@` lists the members; Reviewer is picked from it, then the rest is typed.
    await composer.click();
    await composer.pressSequentially('@Rev', { delay: 70 });
    await page.waitForTimeout(500);
    await clickOn(page, page.getByRole('option', { name: 'Reviewer' }));
    await composer.pressSequentially(GROUP_POST.slice(MENTION.length), { delay: 25 });
    await page.waitForTimeout(600);
    await composer.press('Enter');

    await recordUntil(page, recorder, () => play.done());
    await page.waitForTimeout(4000);
    return { page, recorder };
  },
};
