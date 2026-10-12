/**
 * How-to: give a new task its own worktree. Create a branch from Branches
 * (the checkout stays where it is), start a new session, and put it on a new
 * worktree for that branch from the composer's checkout picker.
 */
import { clickOn, ScreenRecorder, showCursor, type Clip } from '../clip';
import { openWorkspace } from '../scene';
import { FIX_READY } from '../scenes/ready';

const BRANCH = 'feat/link-previews';
const WORKTREE = 'link-previews';

export const guideWorktree: Clip = {
  name: 'guide-worktree',
  live: [],
  async record(ctx, theme, framesDir) {
    const page = await openWorkspace(ctx, theme, {
      columns: [[ctx.world.sessions.fixExpiredLinks!]],
      rightActive: 'branches',
      docks: { right: true },
      readyTexts: [FIX_READY],
    });
    await showCursor(page);
    const recorder = await ScreenRecorder.start(page, framesDir);
    await page.waitForTimeout(1200);

    // A branch for the task, from the current commit.
    await clickOn(page, page.getByRole('button', { name: 'New branch' }));
    const branchName = page.getByRole('textbox', { name: 'New branch name' });
    await branchName.pressSequentially(BRANCH, { delay: 40 });
    await page.waitForTimeout(300);
    await clickOn(page, page.getByRole('button', { name: 'Create', exact: true }).first());
    await page.getByRole('textbox', { name: 'New branch name' }).waitFor({ state: 'detached' });
    await page.waitForTimeout(1200);

    // A new session on a new worktree for that branch.
    await clickOn(page, page.getByRole('button', { name: 'New Chat' }).filter({ visible: true }).first());
    await page.getByText('Start a conversation').first().waitFor();
    await page.waitForTimeout(600);
    await clickOn(page, page.getByRole('button', { name: /^Session checkout:/ }).filter({ visible: true }).first());
    await clickOn(page, page.getByRole('option').filter({ hasText: 'New worktree' }).first());
    await clickOn(page, page.getByRole('option').filter({ hasText: BRANCH }).first());
    const worktreeName = page.getByRole('textbox', { name: 'Worktree name' });
    await clickOn(page, worktreeName);
    await worktreeName.fill('');
    await worktreeName.pressSequentially(WORKTREE, { delay: 40 });
    await page.waitForTimeout(300);
    await clickOn(page, page.getByRole('button', { name: 'Create', exact: true }).last());
    await page.getByRole('button', { name: `Session checkout: ${WORKTREE}` }).first().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(1500);

    // The new worktree next to the others.
    await clickOn(page, page.getByRole('tab', { name: 'Worktrees' }).first());
    await page.getByText(WORKTREE, { exact: true }).first().waitFor();
    await page.mouse.move(1150, 640, { steps: 20 });
    await page.waitForTimeout(3000);
    return { page, recorder };
  },
};
