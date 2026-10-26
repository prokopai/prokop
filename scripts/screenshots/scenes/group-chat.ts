/**
 * The group chat after its conversation: the post, Reviewer's reply with its
 * tool rows, the handoff line, Tester's reply. Opened from the sidebar, like
 * a user would, on the desktop and on the phone.
 */
import type { Page } from 'playwright-core';
import { around, openClient, openWorkspace, PHONE, type Rect, type Scene, type SceneContext, type Theme } from '../scene';
import { GROUP_NAME, GROUP_READY } from '../world/group';
import { FIX_READY } from './ready';

/** Clicks the group's row in the sidebar and waits for its thread. */
export async function openGroup(page: Page): Promise<void> {
  // The row's name carries the member names after the group's.
  await page.getByRole('button', { name: new RegExp(`^${GROUP_NAME}`) }).filter({ visible: true }).first().click();
  await page.getByText(GROUP_READY).first().waitFor();
}

async function openDesktop(ctx: SceneContext, theme: Theme): Promise<Page> {
  const page = await openWorkspace(ctx, theme, { columns: [[ctx.world.sessions.fixExpiredLinks]], readyTexts: [FIX_READY] });
  await openGroup(page);
  return page;
}

export const groupChat: Scene = { name: 'group-chat', open: openDesktop };

export const mobileGroup: Scene = {
  name: 'mobile-group',
  async open(ctx, theme) {
    const { page, serverId } = await openClient(ctx, theme, PHONE);
    await page.goto(`${ctx.instance.url}/server/${serverId}/workspace/session/${ctx.world.sessions.fixExpiredLinks}`);
    await page.getByText(FIX_READY).first().waitFor();
    // The sessions surface holds the groups section.
    await page.getByRole('button', { name: 'Show Sessions' }).click();
    await openGroup(page);
    return page;
  },
};

/** The thread from the post down to the composer, for the homepage tile. */
export const galleryGroup: Scene = {
  name: 'gallery-group',
  open: openDesktop,
  async clip(page): Promise<Rect> {
    const composer = await page.getByRole('textbox', { name: /Message the group/ }).filter({ visible: true }).first().boundingBox();
    const ready = await page.getByText(GROUP_READY).first().boundingBox();
    if (!composer || !ready) throw new Error('Group composer or Tester reply missing');
    // Up to the handoff line above Reviewer's reply.
    const top = { x: composer.x, y: ready.y - 560, width: composer.width, height: 1 };
    const bottom = { x: composer.x, y: composer.y + composer.height + 56, width: composer.width, height: 1 };
    return around(page, [top, ready, composer, bottom], 24);
  },
};
