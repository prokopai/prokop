/**
 * bun run clips [--clip <name>]... [--theme <mode-scheme>] [--out <dir>] [--port <n>] [--home <dir>] [--keep]
 *
 * For each clip, boots the same isolated sandbox instance as
 * `bun run screenshots`, builds the world around it, and records it as
 * `<clip>.<mode>-<scheme>.{webm,mp4,webp,gif}`.
 *
 * One theme per run (default dark-neutral): each clip plays its turn live
 * once, in real time.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';
import { encode, type Clip, type ClipContext } from './clip';
import { commandApprovalClip } from './clips/command-approval';
import { gitWorkbenchClip } from './clips/git-workbench';
import { mobileClip } from './clips/mobile';
import { multiSessionClip } from './clips/multi-session';
import { REPO_ROOT, startInstance, type Instance } from './instance';
import { lastPage, THEMES, themeName } from './scene';
import { Demo } from './script';
import { buildClipWorld } from './world';

const CLIPS: Clip[] = [commandApprovalClip, multiSessionClip, mobileClip, gitWorkbenchClip];

const { values } = parseArgs({
  options: {
    clip: { type: 'string', multiple: true },
    theme: { type: 'string', default: 'dark-neutral' },
    out: { type: 'string', default: join(import.meta.dir, 'out/clips') },
    port: { type: 'string', default: '18742' },
    home: { type: 'string' },
    keep: { type: 'boolean', default: false },
  },
});

const clips = values.clip?.length ? CLIPS.filter((clip) => values.clip!.includes(clip.name)) : CLIPS;
if (clips.length === 0) {
  console.error(`Unknown clip. Available: ${CLIPS.map((clip) => clip.name).join(', ')}`);
  process.exit(1);
}

const theme = THEMES.find((candidate) => themeName(candidate) === values.theme);
if (!theme) {
  console.error(`Unknown theme. Available: ${THEMES.map(themeName).join(', ')}`);
  process.exit(1);
}

const clientIndex = Bun.file(join(REPO_ROOT, 'packages/client/dist/index.html'));
if (!(await clientIndex.exists())) {
  console.error('Client build missing. Run: cd packages/client && VITE_BASE=/ bun run build');
  process.exit(1);
}

mkdirSync(values.out, { recursive: true });
const videoDir = join(values.out, '.raw');
let instance: Instance | null = null;

const shutdown = async () => {
  await instance?.stop();
  process.exit(130);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const browser = await chromium.launch({ channel: 'chrome' });
let failed = false;
try {
  // A fresh instance per clip: the world holds every story except the clip's
  // live ones, so the sidebar around the recording stays full.
  for (const clip of clips) {
    if (instance) await instance.stop();
    instance = await startInstance(Number(values.port), values.home);
    const demo = new Demo(instance.url);
    await demo.connect();
    const name = `${clip.name}.${themeName(theme)}`;
    process.stdout.write(`${name}: world ... `);
    const world = await buildClipWorld(demo, instance.home, clip.live);
    // Clips send their turns from the recorded client, which must hold session control.
    await demo.disconnect();
    process.stdout.write('recording ... ');
    const ctx: ClipContext = { instance, browser, demo, world };
    const recording = await clip.record(ctx, theme, videoDir).catch(async (error: unknown) => {
      const failedPage = lastPage();
      if (failedPage && !failedPage.isClosed()) {
        await failedPage.screenshot({ path: join(values.out, `${name}.failed.png`) });
        console.error(`Saved ${name}.failed.png`);
      }
      throw error;
    });
    const files = await encode(recording, values.out, name);
    console.log(`ok (${files.length} files)`);
  }
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  await browser.close();
  if (values.keep && instance) {
    console.log(`--keep: instance still running at ${instance.url} (home: ${instance.home}). Ctrl-C to stop.`);
  } else {
    await instance?.stop();
  }
}
if (failed) process.exit(1);
