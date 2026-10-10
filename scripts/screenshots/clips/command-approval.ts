/**
 * The build-script turn, live: the prompt is typed and sent, the agent edits
 * package.json and asks to run `rm -rf dist && bun build ...` with only the
 * delete highlighted. The approval is allowed and the real build runs.
 */
import { sendPrompt, stageStory, storyStart, type Clip } from '../clip';
import { openWorkspace } from '../scene';
import type { Step } from '../script';
import { buildScript } from '../world/build-script';

const DONE = 'writes a single `dist/server.js`';

/** The reply after the allowed build ran. */
const BUILT: Step = {
  type: 'text',
  content: `The bundle builds. \`bun run build\` ${DONE} you can deploy on its own.`,
  usage: { inputTokens: 14_210, outputTokens: 36 },
};

export const commandApprovalClip: Clip = {
  name: 'command-approval',
  live: ['buildScript'],
  async record(ctx, theme, videoDir) {
    const sessionId = await stageStory(ctx, buildScript, [BUILT]);

    const openedAt = Date.now();
    const page = await openWorkspace(ctx, theme, {
      columns: [[sessionId]],
      readyTexts: [buildScript.title],
      recordVideoDir: videoDir,
    });
    const trimStartMs = await storyStart(page, openedAt);

    await page.waitForTimeout(600);
    await sendPrompt(page, buildScript.prompt);

    await page.getByText('Allow this command to run?').first().waitFor({ timeout: 60_000 });
    // Time to read the highlighted delete before it is allowed.
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: 'Allow Once' }).click();

    await page.getByText(DONE.replaceAll('`', '')).first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(3000);
    return { page, trimStartMs };
  },
};
