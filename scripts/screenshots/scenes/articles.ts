/**
 * Images for blog articles: a close-up for the post itself and cover crops
 * at the ratios article platforms use (1200x630 Open Graph, 1000x420 dev.to).
 * Covers are plain crops of the app framed on the subject, with no text:
 * the platform puts the title over or next to them.
 */
import type { Page } from 'playwright-core';
import { around, type Rect, type Scene } from '../scene';
import { commandApproval } from './command-approval';

/** The bordered approval card around "Allow this command to run?". */
async function approvalCard(page: Page): Promise<Rect> {
  const card = await page
    .getByText('Allow this command to run?')
    .first()
    .locator('xpath=ancestor::div[contains(concat(" ", @class, " "), " rounded-lg ")][1]')
    .boundingBox();
  if (!card) throw new Error('Approval card missing');
  return card;
}

/**
 * The smallest `ratio` (width / height) crop that holds `content` with at
 * least `pad` around it, centered on it and kept inside the viewport. It
 * ends at most `bottomPad` below the content, so the window edge under the
 * composer stays out; the extra height goes above.
 */
function cover(page: Page, content: Rect, ratio: number, pad: number, bottomPad = 8): Rect {
  const viewport = page.viewportSize()!;
  let width = Math.max(content.width + pad * 2, (content.height + pad + bottomPad) * ratio);
  width = Math.min(width, viewport.width, viewport.height * ratio);
  const height = Math.round(width / ratio);
  width = Math.round(width);
  const x = content.x + content.width / 2 - width / 2;
  const y = Math.min(content.y + content.height / 2 - height / 2, content.y + content.height + bottomPad - height);
  return {
    x: Math.round(Math.min(Math.max(0, x), viewport.width - width)),
    y: Math.round(Math.min(Math.max(0, y), viewport.height - height)),
    width,
    height,
  };
}

const approval: Scene = {
  name: 'article-approval',
  open: commandApproval.open,
  async clip(page) {
    const card = await approvalCard(page);
    return { x: card.x - 16, y: card.y - 16, width: card.width + 32, height: card.height + 32 };
  },
};

/** The agent's last line, the approval card, and down to the composer's checkout footer. */
async function approvalScene(page: Page): Promise<Rect> {
  const said = await page.getByText('Running it once to check the bundle.').first().boundingBox();
  const footer = await page.getByText('(chore/build-script)').first().boundingBox();
  return around(page, [said, await approvalCard(page), footer], 0);
}

function approvalCover(name: string, ratio: number): Scene {
  return {
    name,
    open: commandApproval.open,
    async clip(page) {
      return cover(page, await approvalScene(page), ratio, 32);
    },
  };
}

export const ARTICLE_SCENES: Scene[] = [
  approval,
  approvalCover('article-approval-cover', 1200 / 630),
  approvalCover('article-approval-cover-devto', 1000 / 420),
];
