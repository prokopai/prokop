/**
 * Clips: a story played in a recorded browser page, then encoded for the
 * README (animated WebP, GIF) and for social posts (MP4).
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CDPSession, Locator, Page } from 'playwright-core';
import type { ClientContext, Theme } from './scene';
import type { Demo, Step } from './script';
import { createStorySession, type ClipWorld, type ClipWorldOptions, type Story, type StoryName } from './world';

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
  world?: ClipWorldOptions;
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
  /** Seconds cut out by pauses so far; frame times are shifted back by it. */
  private cut = 0;
  private pausedAt: number | null = null;
  /** The newest frame while paused, shown again when recording resumes. */
  private held: Buffer | null = null;

  private constructor(private readonly session: CDPSession, readonly dir: string) {}

  private keep(data: Buffer, at: number): void {
    const path = join(this.dir, `${String(this.frames.length).padStart(5, '0')}.png`);
    this.frames.push({ path, at: at - this.cut });
    this.writes.push(Bun.write(path, data));
  }

  /** Cuts the time until `resume` out of the clip, such as a model thinking. */
  pause(): void {
    this.pausedAt ??= Date.now() / 1000;
  }

  resume(): void {
    if (this.pausedAt === null) return;
    const now = Date.now() / 1000;
    this.cut += now - this.pausedAt;
    this.pausedAt = null;
    // The screencast sends frames only on change, so restate what is on screen now.
    if (this.held) this.keep(this.held, now);
    this.held = null;
  }

  get paused(): boolean {
    return this.pausedAt !== null;
  }

  /** Starts recording once fonts are ready; the clip begins with this frame. */
  static async start(page: Page, dir: string): Promise<ScreenRecorder> {
    await page.evaluate(() => document.fonts.ready);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const session = await page.context().newCDPSession(page);
    const recorder = new ScreenRecorder(session, dir);
    session.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      const frame = Buffer.from(data, 'base64');
      if (recorder.paused) recorder.held = frame;
      else recorder.keep(frame, metadata.timestamp ?? Date.now() / 1000);
      void session.send('Page.screencastFrameAck', { sessionId }).catch(() => undefined);
    });
    const viewport = page.viewportSize()!;
    await session.send('Page.startScreencast', { format: 'png', maxWidth: viewport.width, maxHeight: viewport.height });
    return recorder;
  }

  /** Stops recording and returns each frame with how long it stays on screen. */
  async stop(): Promise<Array<{ path: string; seconds: number }>> {
    this.resume();
    const endedAt = Date.now() / 1000 - this.cut;
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
  // Claude Code and Codex sessions read "Message Claude CLI …" and "Message Codex CLI …".
  // The composer is a rich editor labelled with its placeholder.
  const composer = page.getByRole('textbox', { name: /^(Type a message|Message \w+ CLI)/ }).filter({ visible: true }).nth(pane);
  // Clicking an inactive pane activates it first; settle before typing into the element itself.
  await composer.click();
  await page.waitForTimeout(300);
  await composer.pressSequentially(prompt, { delay: 25 });
  const typed = (await composer.innerText()).trim();
  if (typed !== prompt) throw new Error(`Composer in pane ${pane} holds ${JSON.stringify(typed)}, not the prompt`);
  await page.waitForTimeout(300);
  // A touch tap, not a click: a click leaves the mouse hovering the button,
  // which turns into Stop and would show its tooltip for the whole turn.
  if (tapSend) await page.getByRole('button', { name: 'Send message' }).filter({ visible: true }).nth(pane).tap();
  else await composer.press('Enter');
}

/**
 * Tutorials show where clicks happen. The screencast never includes the
 * system cursor, so draw one that follows real mouse events, with a ring on
 * each press. Call after the page loaded; it survives client-side navigation.
 */
export async function showCursor(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.getElementById('clip-cursor')) return;
    const cursor = document.createElement('div');
    cursor.id = 'clip-cursor';
    cursor.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l16 9.5-7 1.6 4.2 7.4-2.9 1.6-4.2-7.4L5 20z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    Object.assign(cursor.style, { position: 'fixed', left: '0', top: '0', zIndex: '2147483647', pointerEvents: 'none', transform: 'translate(-100px, -100px)' });
    document.documentElement.appendChild(cursor);
    const ring = (x: number, y: number) => {
      const element = document.createElement('div');
      Object.assign(element.style, {
        position: 'fixed', left: `${x - 14}px`, top: `${y - 14}px`, width: '28px', height: '28px', borderRadius: '50%',
        border: '2px solid rgba(99, 102, 241, 0.9)', background: 'rgba(99, 102, 241, 0.18)', zIndex: '2147483646',
        pointerEvents: 'none', transition: 'transform 0.4s ease-out, opacity 0.4s ease-out',
      });
      document.documentElement.appendChild(element);
      requestAnimationFrame(() => Object.assign(element.style, { transform: 'scale(1.8)', opacity: '0' }));
      setTimeout(() => element.remove(), 450);
    };
    document.addEventListener('mousemove', (event) => {
      cursor.style.transform = `translate(${event.clientX - 4}px, ${event.clientY - 2}px)`;
    }, true);
    document.addEventListener('mousedown', (event) => ring(event.clientX, event.clientY), true);
  });
}

/** Moves the mouse to the element's center at a speed a viewer can follow. */
export async function pointAt(page: Page, target: Locator): Promise<{ x: number; y: number }> {
  await target.waitFor();
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error('Target has no position on screen');
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(point.x, point.y, { steps: 24 });
  await page.waitForTimeout(250);
  return point;
}

/** Points at the element, then clicks it with the real mouse, so the cursor shows the click. */
export async function clickOn(page: Page, target: Locator, { button = 'left' }: { button?: 'left' | 'right' } = {}): Promise<void> {
  const point = await pointAt(page, target);
  await page.mouse.click(point.x, point.y, { button });
  await page.waitForTimeout(400);
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
