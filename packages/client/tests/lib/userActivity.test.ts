import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  ATTENTION_WINDOW_MS,
  hasRecentUserInput,
  installUserActivityTracking,
  isUserAttending,
  markUserActivity,
  resetUserActivityForTests,
  subscribeUserActivity,
} from '@/lib/userActivity';

describe('user activity', () => {
  let uninstall: () => void = () => {};

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    resetUserActivityForTests();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  });

  afterEach(() => {
    uninstall();
    uninstall = () => {};
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  test('a focused window counts as attended only with input inside the window', () => {
    expect(isUserAttending()).toBe(false);
    markUserActivity();
    expect(isUserAttending()).toBe(true);
    vi.setSystemTime(1_000_000 + ATTENTION_WINDOW_MS + 1);
    expect(isUserAttending()).toBe(false);
    expect(hasRecentUserInput()).toBe(false);
  });

  test('hidden or unfocused windows are never attended', () => {
    markUserActivity();
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    expect(isUserAttending()).toBe(false);
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    expect(isUserAttending()).toBe(false);
  });

  test('installing counts the launch, then pointer, key and foreground returns as input', () => {
    uninstall = installUserActivityTracking();
    expect(hasRecentUserInput()).toBe(true);

    vi.setSystemTime(1_000_000 + ATTENTION_WINDOW_MS + 1);
    expect(hasRecentUserInput()).toBe(false);
    window.dispatchEvent(new Event('pointerdown'));
    expect(hasRecentUserInput()).toBe(true);

    vi.setSystemTime(1_000_000 + 2 * ATTENTION_WINDOW_MS + 2);
    expect(hasRecentUserInput()).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(hasRecentUserInput()).toBe(true);

    vi.setSystemTime(1_000_000 + 3 * ATTENTION_WINDOW_MS + 3);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(hasRecentUserInput()).toBe(true);
  });

  test('subscribers hear every input until they unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeUserActivity(listener);
    markUserActivity();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    markUserActivity();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
