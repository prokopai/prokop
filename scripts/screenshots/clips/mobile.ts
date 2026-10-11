/** The expired-links fix on a phone, from the typed report to the passing test run. */
import { sendPrompt, stageStory, ScreenRecorder, type Clip } from '../clip';
import { openSession, PHONE } from '../scene';
import { FIX_EXPIRED_LINKS_READY } from '../world';
import { fixExpiredLinks } from '../world/fix-expired-links';

export const mobileClip: Clip = {
  name: 'mobile',
  live: ['fixExpiredLinks'],
  async record(ctx, theme, framesDir) {
    const sessionId = await stageStory(ctx, fixExpiredLinks);

    const page = await openSession(ctx, theme, sessionId, fixExpiredLinks.title, PHONE);
    const recorder = await ScreenRecorder.start(page, framesDir);

    await page.waitForTimeout(600);
    await sendPrompt(page, fixExpiredLinks.prompt, 0, { tapSend: true });

    await page.getByText(FIX_EXPIRED_LINKS_READY).first().waitFor({ timeout: 90_000 });
    await page.waitForTimeout(3000);
    return { page, recorder };
  },
};
