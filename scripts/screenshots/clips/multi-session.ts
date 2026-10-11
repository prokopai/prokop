/**
 * Two sessions side by side: the rate-limit task starts in its worktree, and
 * a question goes to the second pane while the first is still working.
 */
import { sendPrompt, stageStory, ScreenRecorder, type Clip } from '../clip';
import { openWorkspace } from '../scene';
import { RATE_LIMIT_READY, SLUGS_READY } from '../scenes/ready';
import { explainSlugs } from '../world/explain-slugs';
import { rateLimit } from '../world/rate-limit';

export const multiSessionClip: Clip = {
  name: 'multi-session',
  live: ['rateLimit', 'explainSlugs'],
  async record(ctx, theme, framesDir) {
    // After its steps the rate-limit turn waits on a model call, so it stays running.
    const rateLimitId = await stageStory(ctx, rateLimit);
    const slugsId = await stageStory(ctx, explainSlugs);

    const page = await openWorkspace(ctx, theme, {
      columns: [[rateLimitId], [slugsId]],
      readyTexts: [rateLimit.title, explainSlugs.title],
    });
    const recorder = await ScreenRecorder.start(page, framesDir);

    await page.waitForTimeout(600);
    await sendPrompt(page, rateLimit.prompt, 0);
    await page.waitForTimeout(1200);
    await sendPrompt(page, explainSlugs.prompt, 1);

    await page.getByText(SLUGS_READY).first().waitFor({ timeout: 60_000 });
    await page.getByText(RATE_LIMIT_READY).first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(3000);
    return { page, recorder };
  },
};
