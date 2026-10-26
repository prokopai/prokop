/**
 * The delegating session on the left, its two children stacked on the right:
 * Reviewer's review on Claude Code and the cleanup session in its worktree.
 */
import { around, openSession, openWorkspace, type Rect, type Scene } from '../scene';
import { CLEANUP_READY, DELEGATION_PROMPT, DELEGATION_READY } from '../world/delegation';

export const delegation: Scene = {
  name: 'delegation',
  open: (ctx, theme) => {
    const { parent, review, cleanup } = ctx.world.delegation;
    return openWorkspace(ctx, theme, {
      columns: [[parent], [review, cleanup]],
      readyTexts: [DELEGATION_READY, CLEANUP_READY],
    });
  },
};

/**
 * Only the parent's thread, from the prompt to the last reply, for a column
 * on the website: the two `delegate_task` rows and both finished notes with
 * their runtime, readable where the three-pane shot is not.
 */
export const delegationThread: Scene = {
  name: 'delegation-thread',
  open: (ctx, theme) => openSession(ctx, theme, ctx.world.delegation.parent, DELEGATION_READY),
  async clip(page): Promise<Rect> {
    const prompt = await page.getByText(DELEGATION_PROMPT).first().boundingBox();
    const ready = await page.getByText(DELEGATION_READY).first().boundingBox();
    if (!prompt || !ready) throw new Error('Delegation prompt or last reply missing');
    // The replies sit flush left of the prompt bubble; keep that margin on both sides.
    const left = { x: prompt.x - 130, y: prompt.y, width: 1, height: 1 };
    return around(page, [left, prompt, ready], 40);
  },
};
