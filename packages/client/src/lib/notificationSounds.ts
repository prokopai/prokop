import chatFinishSound from '@/assets/sounds/chat-finish.mp3';
import chatPermissionSound from '@/assets/sounds/chat-permission.mp3';

/**
 * The two attention cues. One AudioContext for the page, unlocked by the
 * first gesture after load and kept for the whole visit. A cue is played at
 * once or not at all: a context that cannot start within a few seconds (no
 * gesture yet, a tab Safari suspended) drops the cue instead of playing it
 * minutes later on the next click.
 */

export type NotificationSoundKey = 'chatFinish' | 'chatPermission';

const SOUND_URLS: Record<NotificationSoundKey, string> = {
  chatFinish: chatFinishSound,
  chatPermission: chatPermissionSound,
};

/** A cue older than this is stale; nothing it announces is news any more. */
export const SOUND_FRESHNESS_MS = 3_000;

const UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const;

interface SoundRuntime {
  context: AudioContext | null;
  buffers: Partial<Record<NotificationSoundKey, AudioBuffer>>;
  unlocked: boolean;
  pending: { key: NotificationSoundKey; requestedAt: number } | null;
  primed: boolean;
}

const runtime: SoundRuntime = { context: null, buffers: {}, unlocked: false, pending: null, primed: false };

function hasAudio(): boolean {
  return typeof AudioContext === 'function';
}

function hadUserActivation(): boolean {
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  return activation?.hasBeenActive === true;
}

function getContext(): AudioContext | null {
  if (!hasAudio()) return null;
  if (!runtime.context || runtime.context.state === 'closed') {
    runtime.context = new AudioContext();
    runtime.buffers = {};
  }
  return runtime.context;
}

const isRunning = (context: AudioContext): boolean => context.state === 'running';

/** Resolves true when the context is running, false when it is not by the deadline. */
async function ensureRunning(context: AudioContext, deadlineMs: number): Promise<boolean> {
  if (isRunning(context)) return true;
  if (deadlineMs <= 0) return false;
  const resumed = context.resume().then(() => true, () => false);
  const timeout = new Promise<boolean>((resolve) => { setTimeout(() => resolve(false), deadlineMs); });
  await Promise.race([resumed, timeout]);
  return isRunning(context);
}

async function loadBuffer(key: NotificationSoundKey, context: AudioContext): Promise<AudioBuffer | null> {
  const cached = runtime.buffers[key];
  if (cached) return cached;
  try {
    const response = await fetch(SOUND_URLS[key]);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = await context.decodeAudioData(await response.arrayBuffer());
    runtime.buffers[key] = buffer;
    return buffer;
  } catch (error) {
    console.warn('[notificationSounds] Failed to load', key, error);
    return null;
  }
}

function startBuffer(buffer: AudioBuffer, context: AudioContext): void {
  try {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start(0);
  } catch (error) {
    console.warn('[notificationSounds] Playback error', error);
  }
}

async function playFresh(key: NotificationSoundKey, requestedAt: number): Promise<void> {
  const context = getContext();
  if (!context) return;
  const remaining = () => SOUND_FRESHNESS_MS - (Date.now() - requestedAt);
  if (!await ensureRunning(context, remaining())) return;
  const buffer = await loadBuffer(key, context);
  if (!buffer || remaining() < 0) return;
  startBuffer(buffer, context);
}

/** Called inside a gesture handler: starts the context and warms both buffers. */
async function unlock(): Promise<void> {
  const context = getContext();
  if (!context) return;
  const running = await ensureRunning(context, SOUND_FRESHNESS_MS);
  if (!running) return;
  runtime.unlocked = true;
  const pending = runtime.pending;
  runtime.pending = null;
  void Promise.all((Object.keys(SOUND_URLS) as NotificationSoundKey[]).map((key) => loadBuffer(key, context)));
  if (pending && Date.now() - pending.requestedAt <= SOUND_FRESHNESS_MS) {
    await playFresh(pending.key, pending.requestedAt);
  }
}

/**
 * Arms the page so the first cue can play without waiting for a gesture:
 * one-shot listeners unlock on the first input, and a page that already had
 * activation (a client-side navigation) unlocks right away.
 */
export function primeNotificationSounds(): void {
  if (runtime.primed || !hasAudio()) return;
  runtime.primed = true;
  const onGesture = () => {
    for (const type of UNLOCK_EVENTS) window.removeEventListener(type, onGesture, { capture: true });
    void unlock().then(() => {
      // Not running after this gesture (Safari may need another): re-arm.
      if (!runtime.unlocked) {
        runtime.primed = false;
        primeNotificationSounds();
      }
    });
  };
  for (const type of UNLOCK_EVENTS) window.addEventListener(type, onGesture, { capture: true, passive: true });
  if (hadUserActivation()) onGesture();
}

/** Plays a cue now, or drops it when the context cannot start in time. */
export function playNotificationSound(key: NotificationSoundKey): void {
  if (!hasAudio()) return;
  const requestedAt = Date.now();
  if (runtime.unlocked) {
    void playFresh(key, requestedAt);
    return;
  }
  // The browser may allow playback already (the page was interacted with
  // before this module was primed); try, and otherwise wait for a gesture
  // while the cue is still fresh.
  runtime.pending = { key, requestedAt };
  if (hadUserActivation()) void unlock();
  else primeNotificationSounds();
}

/** Test seam: closes the context and forgets all state. */
export function resetNotificationSoundsForTests(): void {
  if (runtime.context && runtime.context.state !== 'closed') void runtime.context.close();
  runtime.context = null;
  runtime.buffers = {};
  runtime.unlocked = false;
  runtime.pending = null;
  runtime.primed = false;
}
