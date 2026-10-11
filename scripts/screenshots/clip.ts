/**
 * Clips: a story played in a recorded browser page, then encoded for the
 * README (animated WebP, GIF) and for social posts (MP4).
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CDPSession, Page } from 'playwright-core';
import type { ClientContext, Theme } from './scene';
import type { Demo, Step } from './script';
import { createStorySession, type ClipWorld, type Story, type StoryName } from './world';

export interface ClipContext extends ClientContext {
  demo: Demo;
  world: ClipWorld;
}

export interface Recording {
  page: Page;
  recorder: ScreenRecorder;
}

export interface Clip {
  name: string;
  /** Stories the clip plays live; the world leaves them out. */
  live: StoryName[];
  /** Opens the page, records the story into `framesDir`, and resolves once it ended. */
  record(ctx: ClipContext, theme: Theme, framesDir: string): Promise<Recording>;
}

/**
 * Records a page through Chrome's screencast: lossless PNG frames at CSS
 * pixel size, sent only when something on screen changes. Playwright's own
 * video is low-bitrate VP8, which blurs text and bleeds colors.
 */
export class ScreenRecorder {
  private readonly frames: Array<{ path: string; at: number }> = [];
  private readonly writes: Array<Promise<unknown>> = [];

  private constructor(private readonly session: CDPSession, readonly dir: string) {}

  /** Starts recording once fonts are ready; the clip begins with this frame. */
  static async start(page: Page, dir: string): Promise<ScreenRecorder> {
    await page.evaluate(() => document.fonts.ready);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const session = await page.context().newCDPSession(page);
    const recorder = new ScreenRecorder(session, dir);
    session.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      const path = join(dir, `${String(recorder.frames.length).padStart(5, '0')}.png`);
      recorder.frames.push({ path, at: metadata.timestamp ?? Date.now() / 1000 });
      recorder.writes.push(Bun.write(path, Buffer.from(data, 'base64')));
      void session.send('Page.screencastFrameAck', { sessionId }).catch(() => undefined);
    });
    const viewport = page.viewportSize()!;
    await session.send('Page.startScreencast', { format: 'png', maxWidth: viewport.width, maxHeight: viewport.height });
    return recorder;
  }

  /** Stops recording and returns each frame with how long it stays on screen. */
  async stop(): Promise<Array<{ path: string; seconds: number }>> {
    const endedAt = Date.now() / 1000;
    await this.session.send('Page.stopScreencast');
    await Promise.all(this.writes);
    await this.session.detach();
    return this.frames.map((frame, index) => ({
      path: frame.path,
      seconds: Math.max(0.001, (this.frames[index + 1]?.at ?? endedAt) - frame.at),
    }));
  }
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

/** Stops the recording and writes `<name>.mp4`, `.webp` and `.gif` into `outDir` from its frames. */
export async function encode({ page, recorder }: Recording, outDir: string, name: string): Promise<string[]> {
  const frames = await recorder.stop();
  await page.context().close();
  if (frames.length === 0) throw new Error(`No frames recorded for ${name}`);
  // The concat demuxer holds each frame for its recorded duration; the last
  // file is listed twice because its duration is otherwise ignored.
  const list = join(recorder.dir, 'frames.txt');
  writeFileSync(list, [
    ...frames.flatMap((frame) => [`file '${frame.path}'`, `duration ${frame.seconds.toFixed(3)}`]),
    `file '${frames.at(-1)!.path}'`,
  ].join('\n'));

  const input = ['-f', 'concat', '-safe', '0', '-i', list];
  // Scale down to each output's width, never up. The README WebP keeps the
  // full desktop width so it stays sharp on high-density screens.
  const scale = (width: number) => `scale='min(${width},iw)':-2:flags=lanczos`;
  const mp4 = join(outDir, `${name}.mp4`);
  const webp = join(outDir, `${name}.webp`);
  const gif = join(outDir, `${name}.gif`);
  await ffmpeg([...input, '-vf', `fps=30,${scale(1920)}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', '-movflags', '+faststart', mp4]);
  await ffmpeg([...input, '-vf', `fps=15,${scale(1440)}`, '-c:v', 'libwebp_anim', '-quality', '90', '-loop', '0', webp]);
  await ffmpeg([
    ...input,
    '-vf', `fps=12,${scale(960)},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`,
    '-loop', '0', gif,
  ]);
  rmSync(recorder.dir, { recursive: true, force: true });
  return [mp4, webp, gif];
}
