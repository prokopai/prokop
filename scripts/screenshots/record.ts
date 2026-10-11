/**
 * bun run clips [--clip <name>]... [--theme <filter>]... [--out <dir>] [--port <n>] [--home <dir>] [--keep]
 *
 * For each clip and theme, boots the same isolated sandbox instance as
 * `bun run screenshots`, builds the world around it, and records it as
 * `<clip>.<mode>-<scheme>.{mp4,webp,gif}`.
 *
 * --theme accepts a mode (`dark`), a scheme (`ocean`), or both (`dark-ocean`).
 * Default: dark-neutral only. Each recording plays its turn live, in real
 * time, so all 10 themes (`--theme dark --theme light`) take a while.
 *
 * A failed recording is reported and skipped; the run exits 1 at the end.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';
import { encode, type Clip, type ClipContext } from './clip';
import { commandApprovalClip } from './clips/command-approval';
import { gitWorkbenchClip } from './clips/git-workbench';
import { memoryClip } from './clips/memory';
import { mobileClip } from './clips/mobile';
import { multiSessionClip } from './clips/multi-session';
import { REPO_ROOT, startInstance, type Instance } from './instance';
import { lastPage, THEMES, themeName } from './scene';
import { Demo } from './script';
import { buildClipWorld } from './world';

const CLIPS: Clip[] = [memoryClip, commandApprovalClip, multiSessionClip, mobileClip, gitWorkbenchClip];

const { values } = parseArgs({
  options: {
    clip: { type: 'string', multiple: true },
    theme: { type: 'string', multiple: true, default: ['dark-neutral'] },
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

const themes = THEMES.filter((theme) => values.theme.some((filter) => [theme.mode, theme.scheme, themeName(theme)].includes(filter)));
if (themes.length === 0) {
  console.error(`Unknown theme. Available: ${THEMES.map(themeName).join(', ')}`);
  process.exit(1);
}

const clientIndex = Bun.file(join(REPO_ROOT, 'packages/client/dist/index.html'));
if (!(await clientIndex.exists())) {
  console.error('Client build missing. Run: cd packages/client && VITE_BASE=/ bun run build');
  process.exit(1);
}

mkdirSync(values.out, { recursive: true });
let instance: Instance | null = null;

const shutdown = async () => {
  await instance?.stop();
  process.exit(130);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const browser = await chromium.launch({ channel: 'chrome' });
const failures: string[] = [];
try {
  // A fresh instance per recording: playing a clip uses up its story (edits,
  // commits), and the world holds every other story, so the sidebar stays full.
  for (const clip of clips) {
    for (const theme of themes) {
      const name = `${clip.name}.${themeName(theme)}`;
      const startedAt = Date.now();
      process.stdout.write(`${name}: world ... `);
      try {
        if (instance) await instance.stop();
        instance = await startInstance(Number(values.port), values.home);
        const demo = new Demo(instance.url);
        await demo.connect();
        const world = await buildClipWorld(demo, instance.home, clip.live);
        // Clips send their turns from the recorded client, which must hold session control.
        await demo.disconnect();
        process.stdout.write('recording ... ');
        const ctx: ClipContext = { instance, browser, demo, world };
        const recording = await clip.record(ctx, theme, join(values.out, '.frames', name));
        const files = await encode(recording, values.out, name);
        console.log(`ok (${files.length} files, ${Math.round((Date.now() - startedAt) / 1000)}s)`);
      } catch (error) {
        failures.push(name);
        const failedPage = lastPage();
        if (failedPage && !failedPage.isClosed()) {
          await failedPage.screenshot({ path: join(values.out, `${name}.failed.png`) }).catch(() => undefined);
          await failedPage.context().close().catch(() => undefined);
          console.error(`failed, saved ${name}.failed.png`);
        }
        console.error(error);
      }
    }
  }
} finally {
  await browser.close();
  if (values.keep && instance) {
    console.log(`--keep: instance still running at ${instance.url} (home: ${instance.home}). Ctrl-C to stop.`);
  } else {
    await instance?.stop();
  }
}
const total = clips.length * themes.length;
console.log(`Recorded ${total - failures.length}/${total} to ${values.out}`);
if (failures.length > 0) {
  console.error(`Failed: ${failures.join(', ')}`);
  process.exit(1);
}
