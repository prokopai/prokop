/**
 * Close-up crops for the website's feature gallery. Panel crops reuse the
 * full scenes and cut out one region; the rest open their own views.
 */
import type { Page } from 'playwright-core';
import { around, openWorkspace, type Rect, type Scene } from '../scene';
import { CLICKS_PAGE_TITLE, CLICKS_READY, REDIRECT_FLOW_READY } from '../world/gallery';
import { branches } from './branches';
import { gitWorkbench } from './git-workbench';
import { FIX_READY, RATE_LIMIT_READY } from './ready';
import { terminal } from './terminal';
import { worktrees } from './worktrees';

/** The top of the right dock, 16:10, measured so it holds at any viewport. */
async function rightDock(page: Page, heightRatio = 10 / 16): Promise<Rect> {
  const dock = await box(page, page.locator('[data-dock-position="right"]').filter({ visible: true }));
  if (!dock) throw new Error('Right dock missing');
  const width = dock.width + 12;
  return { x: dock.x - 6, y: dock.y - 6, width, height: Math.round(width * heightRatio) };
}

/** The left of the bottom dock, 16:10 at its full height. */
async function bottomDock(page: Page): Promise<Rect> {
  const dock = await box(page, page.locator('[data-dock-position="bottom"]').filter({ visible: true }));
  if (!dock) throw new Error('Bottom dock missing');
  return { x: dock.x, y: dock.y, width: Math.round(dock.height * 1.6), height: dock.height };
}

function crop(name: string, scene: Scene, rect: (page: Page) => Promise<Rect>): Scene {
  return { name, open: scene.open, clip: rect };
}

async function box(page: Page, selector: ReturnType<Page['locator']>): Promise<Rect | null> {
  return selector.first().boundingBox();
}

const pages: Scene = {
  name: 'gallery-pages',
  async open(ctx, theme) {
    const page = await openWorkspace(ctx, theme, { columns: [[ctx.world.gallery.weeklyClicks]], readyTexts: [CLICKS_READY] });
    const frame = page.frameLocator(`iframe[title="${CLICKS_PAGE_TITLE}"]`);
    await frame.getByText('Redirects counted by').waitFor();
    return page;
  },
  async clip(page) {
    const frame = await box(page, page.locator(`iframe[title="${CLICKS_PAGE_TITLE}"]`));
    const rect = around(page, [frame, await box(page, page.getByText(CLICKS_READY))], 32);
    // Start at the page, below its tool row.
    const top = frame!.y;
    return { ...rect, y: top, height: rect.y + rect.height - top };
  },
};

const diagram: Scene = {
  name: 'gallery-diagram',
  async open(ctx, theme) {
    const page = await openWorkspace(ctx, theme, { columns: [[ctx.world.gallery.redirectFlow]], readyTexts: [REDIRECT_FLOW_READY] });
    await page.locator('[aria-label="Diagram"] svg').first().waitFor();
    return page;
  },
  async clip(page) {
    const diagram = await box(page, page.locator('[aria-label="Diagram"]'));
    const rect = around(page, [diagram, await box(page, page.getByText(REDIRECT_FLOW_READY))], 32);
    // Start just above the diagram, below the tool row.
    const top = diagram!.y - 16;
    return { ...rect, y: top, height: rect.y + rect.height - top };
  },
};

const STEER_TEXT = 'Use a sliding window instead. A fixed window lets a burst through at the edges.';

const steering: Scene = {
  name: 'gallery-steering',
  async open(ctx, theme) {
    const page = await openWorkspace(ctx, theme, { columns: [[ctx.world.sessions.rateLimit]], readyTexts: [RATE_LIMIT_READY] });
    // An earlier theme may have sent it already; the turn has not taken it yet.
    if (!(await page.getByText(STEER_TEXT).first().isVisible())) {
      const composer = page.getByRole('textbox', { name: /Type a message/ }).filter({ visible: true }).first();
      await composer.fill(STEER_TEXT);
      await composer.press('Enter');
    }
    await page.getByText('Steering', { exact: true }).first().waitFor();
    return page;
  },
  async clip(page) {
    const steer = await box(page, page.getByText('Steering', { exact: true }));
    const composer = await box(page, page.getByRole('textbox', { name: /Type a message/ }).filter({ visible: true }));
    const sent = await box(page, page.getByText(STEER_TEXT));
    if (!steer || !composer) throw new Error('Steering bubble or composer missing');
    // Some of the running turn above the bubble, down to the composer's buttons.
    const top = { x: composer.x, y: Math.min(steer.y, sent?.y ?? steer.y) - 110, width: composer.width, height: 1 };
    const bottom = { x: composer.x, y: composer.y + composer.height + 60, width: composer.width, height: 1 };
    return around(page, [top, steer, sent, composer, bottom], 24);
  },
};

const scheduled: Scene = {
  name: 'gallery-scheduled',
  async open(ctx, theme) {
    const page = await openWorkspace(ctx, theme, { columns: [[ctx.world.sessions.fixExpiredLinks]], readyTexts: [FIX_READY] });
    await page.getByText('Scheduled', { exact: true }).first().click();
    await page.getByText('Weekly dependency check').first().click();
    await page.getByRole('dialog').waitFor();
    // The editor focuses and selects the name; nothing should look selected.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    return page;
  },
  async clip(page) {
    // Name, prompt, and schedule: the dialog down to the time picker.
    const dialog = await box(page, page.getByRole('dialog'));
    const time = await box(page, page.getByText('Repeat limit'));
    if (!dialog || !time) throw new Error('Scheduled job editor missing');
    return { x: dialog.x, y: dialog.y, width: dialog.width, height: time.y - dialog.y - 8 };
  },
};

export const GALLERY_SCENES: Scene[] = [
  pages,
  diagram,
  scheduled,
  // The worktree list is short; less empty panel below it.
  crop('gallery-worktrees', worktrees, (page) => rightDock(page, 250 / 552)),
  crop('gallery-branches', branches, (page) => rightDock(page)),
  crop('gallery-changes', gitWorkbench, (page) => rightDock(page)),
  crop('gallery-terminal', terminal, bottomDock),
  // Last: it sends a message into the running rate-limit turn.
  steering,
];
