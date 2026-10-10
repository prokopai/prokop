/**
 * From agent edits to a commit: the stats change streams in its worktree,
 * its diff is previewed from Changes, and both files are committed.
 */
import { sendPrompt, stageStory, storyStart, type Clip } from '../clip';
import { clickTreeItem, openWorkspace } from '../scene';
import { STATS_READY } from '../scenes/ready';
import { statsExpiredFlag } from '../world/stats-expired-flag';

export const gitWorkbenchClip: Clip = {
  name: 'git-workbench',
  live: ['statsExpiredFlag'],
  async record(ctx, theme, videoDir) {
    const sessionId = await stageStory(ctx, statsExpiredFlag);

    const openedAt = Date.now();
    const page = await openWorkspace(ctx, theme, {
      columns: [[sessionId]],
      rightActive: 'changes',
      docks: { right: true },
      readyTexts: [statsExpiredFlag.title],
      recordVideoDir: videoDir,
    });
    const trimStartMs = await storyStart(page, openedAt);

    await page.waitForTimeout(600);
    await sendPrompt(page, statsExpiredFlag.prompt);
    await page.getByText(STATS_READY).first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1500);

    // Review the handler's diff before committing.
    await clickTreeItem(page, 'src/routes/links.ts');
    await page.getByRole('dialog').waitFor();
    await page.waitForTimeout(2500);
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });

    await page.getByRole('button', { name: 'Commit…' }).click();
    await page.getByRole('checkbox', { name: 'Select all matching files' }).click();
    await page.getByRole('textbox', { name: 'Commit message' }).click();
    await page.keyboard.type('Report expired links in stats', { delay: 35 });
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Commit', exact: true }).click();
    await page.getByText(/Committed [0-9a-f]{8}/).first().waitFor();
    await page.waitForTimeout(2500);
    return { page, trimStartMs };
  },
};
