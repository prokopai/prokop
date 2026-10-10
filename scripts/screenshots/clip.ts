/**
 * Clips: a story played in a recorded browser page, then encoded for the
 * README (animated WebP, GIF) and for social posts (MP4).
 */
import { renameSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright-core';
import type { ClientContext, Theme } from './scene';
import type { Demo, Step } from './script';
import { createStorySession, type ClipWorld, type Story, type StoryName } from './world';

export interface ClipContext extends ClientContext {
  demo: Demo;
  world: ClipWorld;
}

export interface Recording {
  page: Page;
  /** Recorded time before the story starts (page load), cut from the output. */
  trimStartMs: number;
}

export interface Clip {
  name: string;
  /** Stories the clip plays live; the world leaves them out. */
  live: StoryName[];
  /** Plays the story in a page recording into `videoDir`; resolves once it ended. */
  record(ctx: ClipContext, theme: Theme, videoDir: string): Promise<Recording>;
}

/** Word-by-word streaming at a pace a viewer can follow. */
export function paced(step: Step): Step {
  return step.type === 'error' ? step : { ...step, pacing: { initialDelayMs: 700, chunkDelayMs: 60 } };
}

/**
 * Creates the story's session and queues its steps, paced, for the recorded
 * client to send. `extraSteps` continue past where the world stops the turn.
 */
export async function stageStory(ctx: ClipContext, story: Story, extraSteps: Step[] = []): Promise<string> {
  const sessionId = await createStorySession(ctx.demo, ctx.world, story);
  await ctx.demo.queueSteps(sessionId, [...story.steps, ...extraSteps].map(paced));
  return sessionId;
}

/** Waits for fonts, returning how long the page took to get here, which the encoder trims. */
export async function storyStart(page: Page, openedAt: number): Promise<number> {
  await page.evaluate(() => document.fonts.ready);
  return Date.now() - openedAt;
}

/**
 * Types the prompt into a session pane's composer (by board order) and sends
 * it. Only visible composers count; the board keeps hidden views mounted.
 */
export async function sendPrompt(page: Page, prompt: string, pane = 0, { tapSend = false } = {}): Promise<void> {
  const composer = page.getByPlaceholder(/Type a message/).filter({ visible: true }).nth(pane);
  // Clicking an inactive pane activates it first; settle before typing into the element itself.
  await composer.click();
  await page.waitForTimeout(300);
  await composer.pressSequentially(prompt, { delay: 25 });
  const typed = await composer.inputValue();
  if (typed !== prompt) throw new Error(`Composer in pane ${pane} holds ${JSON.stringify(typed)}, not the prompt`);
  await page.waitForTimeout(300);
  // A touch tap, not a click: a click leaves the mouse hovering the button,
  // which turns into Stop and would show its tooltip for the whole turn.
  if (tapSend) await page.getByRole('button', { name: 'Send message' }).filter({ visible: true }).nth(pane).tap();
  else await composer.press('Enter');
}

async function ffmpeg(args: string[]): Promise<void> {
  const proc = Bun.spawn(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', ...args], { stderr: 'inherit' });
  if ((await proc.exited) !== 0) throw new Error(`ffmpeg failed: ${args.join(' ')}`);
}

/** Closes the recording and writes `<name>.webm` (raw), `.mp4`, `.webp` and `.gif` into `outDir`. */
export async function encode({ page, trimStartMs }: Recording, outDir: string, name: string): Promise<string[]> {
  const video = page.video();
  if (!video) throw new Error('Page was not recorded');
  // The video is only complete once its context is closed.
  await page.context().close();
  const raw = join(outDir, `${name}.webm`);
  renameSync(await video.path(), raw);

  const input = ['-ss', (trimStartMs / 1000).toFixed(2), '-i', raw];
  // Downscale wide desktop video only; phone video is already narrow.
  const scale = (width: number) => `scale='min(${width},iw)':-2:flags=lanczos`;
  const mp4 = join(outDir, `${name}.mp4`);
  const webp = join(outDir, `${name}.webp`);
  const gif = join(outDir, `${name}.gif`);
  await ffmpeg([...input, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', mp4]);
  await ffmpeg([...input, '-vf', `fps=15,${scale(1200)}`, '-c:v', 'libwebp_anim', '-quality', '80', '-loop', '0', webp]);
  await ffmpeg([
    ...input,
    '-vf', `fps=12,${scale(960)},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`,
    '-loop', '0', gif,
  ]);
  return [raw, mp4, webp, gif];
}
