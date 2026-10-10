/** The expired-links fix on a phone, from the typed report to the passing test run. */
import { sendPrompt, stageStory, storyStart, type Clip } from '../clip';
import { openSession, PHONE } from '../scene';
import { FIX_EXPIRED_LINKS_READY } from '../world';
import { fixExpiredLinks } from '../world/fix-expired-links';

export const mobileClip: Clip = {
  name: 'mobile',
  live: ['fixExpiredLinks'],
  async record(ctx, theme, videoDir) {
    const sessionId = await stageStory(ctx, fixExpiredLinks);

    const openedAt = Date.now();
    const page = await openSession(ctx, theme, sessionId, fixExpiredLinks.title, PHONE, videoDir);
    const trimStartMs = await storyStart(page, openedAt);

    await page.waitForTimeout(600);
    await sendPrompt(page, fixExpiredLinks.prompt, 0, { tapSend: true });

    await page.getByText(FIX_EXPIRED_LINKS_READY).first().waitFor({ timeout: 90_000 });
    await page.waitForTimeout(3000);
    return { page, trimStartMs };
  },
};
