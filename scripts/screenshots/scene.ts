import { join } from 'node:path';
import type { Browser, Page } from 'playwright-core';
import type { Instance } from './instance';
import { workspaceLayout, type RightView } from './layout';
import type { World } from './world';

export const THEME_MODES = ['light', 'dark'] as const;
/** Mirrors `ThemeScheme` in packages/client/src/components/providers/ThemeProvider.tsx. */
export const THEME_SCHEMES = ['neutral', 'ocean', 'forest', 'sunset', 'amethyst'] as const;

export interface Theme {
  mode: (typeof THEME_MODES)[number];
  scheme: (typeof THEME_SCHEMES)[number];
}

export const THEMES: Theme[] = THEME_MODES.flatMap((mode) => THEME_SCHEMES.map((scheme) => ({ mode, scheme })));

export function themeName(theme: Theme): string {
  return `${theme.mode}-${theme.scheme}`;
}

export interface SceneContext {
  instance: Instance;
  browser: Browser;
  world: World;
}

export interface Scene {
  name: string;
  /** Opens the view in the given theme and resolves once it is ready to capture. */
  open(ctx: SceneContext, theme: Theme): Promise<Page>;
  /** Captures only this region, in CSS pixels, instead of the whole viewport. */
  clip?(page: Page): Promise<Rect>;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The smallest rect covering every box, grown by `pad` and kept inside the viewport. */
export function around(page: Page, boxes: Array<Rect | null>, pad = 24): Rect {
  const present = boxes.filter((box): box is Rect => box !== null);
  if (present.length === 0) throw new Error('Nothing to clip around');
  const viewport = page.viewportSize()!;
  const x = Math.max(0, Math.min(...present.map((box) => box.x)) - pad);
  const y = Math.max(0, Math.min(...present.map((box) => box.y)) - pad);
  const right = Math.min(viewport.width, Math.max(...present.map((box) => box.x + box.width)) + pad);
  const bottom = Math.min(viewport.height, Math.max(...present.map((box) => box.y + box.height)) + pad);
  return { x, y, width: right - x, height: bottom - y };
}

const SCREENSHOT_CLIENT_ID = '7c1e2d4a-5b3f-4e6a-9d8c-0f1a2b3c4d5e';

export const DESKTOP = { width: 1920, height: 1080 };
export const PHONE = { width: 390, height: 844 };

let lastOpenedPage: Page | null = null;

/** The most recently opened page, for failure screenshots. */
export function lastPage(): Page | null {
  return lastOpenedPage;
}

/** What opening the client needs; clips run against a different world. */
export type ClientContext = Pick<SceneContext, 'instance' | 'browser'> & { world: Pick<World, 'workspaceId'> };

/** Opens the client in a fresh context with the theme preset, and returns the page plus its client-side server id. */
export async function openClient(ctx: ClientContext, theme: Theme, viewport = DESKTOP): Promise<{ page: Page; serverId: string }> {
  const phone = viewport.width < 768;
  const context = await ctx.browser.newContext({
    viewport,
    deviceScaleFactor: phone ? 3 : 2,
    isMobile: phone,
    hasTouch: phone,
    colorScheme: theme.mode,
  });
  await context.addInitScript(({ settings, clientId, workspaceId }) => {
    localStorage.setItem('prokopai-theme-settings', settings);
    // One client identity across contexts; otherwise the server sees a new
    // device per scene and the previous one keeps session control.
    localStorage.setItem('prokopai_client_id', clientId);
    // Open on linkshelf; with no saved choice the client takes the first
    // workspace by name, which is invoicer.
    localStorage.setItem('activeWorkspaceId', workspaceId);
  }, { settings: JSON.stringify(theme), clientId: JSON.stringify(SCREENSHOT_CLIENT_ID), workspaceId: ctx.world.workspaceId });
  const page = await context.newPage();
  lastOpenedPage = page;
  await page.goto(ctx.instance.url);
  await page.waitForURL(/\/server\/[^/]+/);
  const serverId = new URL(page.url()).pathname.split('/')[2]!;
  return { page, serverId };
}

/** Opens a session and waits until `readyText` (e.g. part of the last reply) is visible. */
export async function openSession(ctx: ClientContext, theme: Theme, sessionId: string, readyText: string, viewport = DESKTOP): Promise<Page> {
  const { page, serverId } = await openClient(ctx, theme, viewport);
  await page.goto(`${ctx.instance.url}/server/${serverId}/workspace/session/${sessionId}`);
  await page.getByText(readyText).first().waitFor();
  return page;
}

export interface WorkspaceOptions {
  /** Session panes as columns of stacked session ids; the first one is focused. */
  columns: string[][];
  rightActive?: RightView;
  /** Docks to open after load; their visibility is not persisted. */
  docks?: { right?: boolean; bottom?: boolean };
  /** Bottom dock height in px. */
  bottomSize?: number;
  /** Texts that must be visible before the scene continues. */
  readyTexts: string[];
  viewport?: { width: number; height: number };
}

/** Opens the workspace with a preset pane layout and docks. */
export async function openWorkspace(ctx: ClientContext, theme: Theme, options: WorkspaceOptions): Promise<Page> {
  const { page, serverId } = await openClient(ctx, theme, options.viewport);
  const layout = JSON.stringify(workspaceLayout(serverId, options.columns, options.rightActive));
  const docks = options.bottomSize ? JSON.stringify({ version: 1, sizes: { left: 256, right: 540, bottom: options.bottomSize } }) : null;
  // Before any client code runs, so the stores load these instead of their defaults.
  await page.context().addInitScript(({ layout, docks }) => {
    localStorage.setItem('prokopai_workspace_views', layout);
    if (docks) localStorage.setItem('prokopai_dock_sizes', docks);
  }, { layout, docks });

  const sessionIds = options.columns.flat();
  const open = sessionIds.length > 1 ? `?open=${sessionIds.join(',')}` : '';
  await page.goto(`${ctx.instance.url}/server/${serverId}/workspace/session/${sessionIds[0]}${open}`);
  for (const text of options.readyTexts) await page.getByText(text).first().waitFor();
  if (options.docks?.right) await page.getByRole('button', { name: 'Show right dock' }).click();
  if (options.docks?.bottom) await page.getByRole('button', { name: 'Show bottom dock' }).click();
  return page;
}

/** Clicks a row in the file trees, which render inside an open shadow root. */
export async function clickTreeItem(page: Page, path: string): Promise<void> {
  await page.locator(`[data-item-path="${path}"]`).filter({ visible: true }).first().click();
}

/**
 * Types commands into the visible terminal, one line each. The terminal lives
 * on the server across scenes, so it is cleared first.
 */
export async function typeInTerminal(page: Page, commands: string[]): Promise<void> {
  await page.locator('.xterm').filter({ visible: true }).first().click();
  for (const command of ['clear', ...commands]) {
    await page.keyboard.type(command, { delay: 10 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
  }
}

export async function capture(page: Page, outDir: string, name: string, clip?: Rect): Promise<string> {
  // Let fonts, highlighting, and enter animations settle.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  const path = join(outDir, `${name}.png`);
  await page.screenshot({ path, clip });
  return path;
}
