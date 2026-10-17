import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  SOUND_FRESHNESS_MS,
  playNotificationSound,
  primeNotificationSounds,
  resetNotificationSoundsForTests,
} from '@/lib/notificationSounds';

/** Enough of the Web Audio API to see what starts and when. */
class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  static resumeHangs = false;
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  started: string[] = [];
  destination = {};

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  resume(): Promise<void> {
    if (FakeAudioContext.resumeHangs) return new Promise(() => {});
    this.state = 'running';
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }

  decodeAudioData(data: ArrayBuffer): Promise<{ name: string }> {
    return Promise.resolve({ name: new TextDecoder().decode(data) });
  }

  createBufferSource() {
    const context = this;
    return {
      buffer: null as { name: string } | null,
      connect() {},
      start() {
        context.started.push(this.buffer?.name ?? '?');
      },
    };
  }
}

const started = () => FakeAudioContext.instances.flatMap((context) => context.started);

/** Lets every queued microtask (fetch, decode, resume) settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function setUserActivation(hasBeenActive: boolean): void {
  Object.defineProperty(navigator, 'userActivation', { configurable: true, value: { hasBeenActive } });
}

describe('notification sounds', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000_000);
    FakeAudioContext.instances = [];
    FakeAudioContext.resumeHangs = false;
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode(url.includes('permission') ? 'permission' : 'finish').buffer,
    })));
    setUserActivation(false);
    resetNotificationSoundsForTests();
  });

  afterEach(() => {
    resetNotificationSoundsForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test('a cue requested before any input plays on the first input while still fresh', async () => {
    primeNotificationSounds();
    playNotificationSound('chatFinish');
    await settle();
    expect(started()).toEqual([]);

    vi.setSystemTime(5_000_000 + 1_000);
    window.dispatchEvent(new Event('pointerdown'));
    await settle();
    expect(started()).toEqual(['finish']);
  });

  test('a stale cue is dropped at the first input instead of playing late', async () => {
    primeNotificationSounds();
    playNotificationSound('chatFinish');
    await settle();

    vi.setSystemTime(5_000_000 + SOUND_FRESHNESS_MS + 1);
    window.dispatchEvent(new Event('pointerdown'));
    await settle();
    expect(started()).toEqual([]);

    // Unlocked now: the next cue plays at once.
    playNotificationSound('chatPermission');
    await settle();
    expect(started()).toEqual(['permission']);
  });

  test('a page that already had input unlocks without waiting for another', async () => {
    setUserActivation(true);
    primeNotificationSounds();
    await settle();
    playNotificationSound('chatFinish');
    await settle();
    expect(started()).toEqual(['finish']);
  });

  test('a context that cannot resume in time drops the cue', async () => {
    setUserActivation(true);
    primeNotificationSounds();
    await settle();
    playNotificationSound('chatFinish');
    await settle();
    expect(started()).toEqual(['finish']);

    // Safari suspended the tab: resume never settles.
    const context = FakeAudioContext.instances[0]!;
    context.state = 'suspended';
    FakeAudioContext.resumeHangs = true;
    playNotificationSound('chatFinish');
    await settle();
    await vi.advanceTimersByTimeAsync(SOUND_FRESHNESS_MS + 10);
    expect(started()).toEqual(['finish']);
  });

  test('both buffers load once at unlock and are reused', async () => {
    primeNotificationSounds();
    window.dispatchEvent(new Event('keydown'));
    await settle();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);

    playNotificationSound('chatFinish');
    playNotificationSound('chatPermission');
    await settle();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    expect(started()).toEqual(['finish', 'permission']);
  });
});
