import { beforeEach, describe, expect, test } from 'vitest';
import {
  USAGE_LAYOUT_KEY, arrangeUsageEntries, hideUsageEntry, loadUsageLayout, moveUsageEntry,
  saveUsageLayout, showUsageEntry,
} from '@/lib/usageLayout';

const entries = [{ id: 'codex:a' }, { id: 'deepseek' }, { id: 'claude-cli' }, { id: 'codex-cli' }];

describe('arrangeUsageEntries', () => {
  test('keeps the natural order without a preference', () => {
    const { visible, hidden } = arrangeUsageEntries(entries, { order: [], hidden: [] });
    expect(visible.map(entry => entry.id)).toEqual(['codex:a', 'deepseek', 'claude-cli', 'codex-cli']);
    expect(hidden).toEqual([]);
  });

  test('orders known groups first and puts unknown ones last, visible', () => {
    const { visible } = arrangeUsageEntries(entries, { order: ['claude-cli', 'deepseek'], hidden: [] });
    expect(visible.map(entry => entry.id)).toEqual(['claude-cli', 'deepseek', 'codex:a', 'codex-cli']);
  });

  test('hidden groups leave the shown list but stay reachable', () => {
    const { visible, hidden } = arrangeUsageEntries(entries, { order: [], hidden: ['deepseek', 'gone'] });
    expect(visible.map(entry => entry.id)).toEqual(['codex:a', 'claude-cli', 'codex-cli']);
    expect(hidden.map(entry => entry.id)).toEqual(['deepseek']);
  });
});

describe('moveUsageEntry', () => {
  test('swaps with the neighbour and records the whole shown order', () => {
    const next = moveUsageEntry({ order: [], hidden: [] }, ['a', 'b', 'c'], 'c', 'up');
    expect(next.order).toEqual(['a', 'c', 'b']);
  });

  test('stays put at the edges or for an unknown id', () => {
    const layout = { order: ['a', 'b'], hidden: [] };
    expect(moveUsageEntry(layout, ['a', 'b'], 'a', 'up')).toBe(layout);
    expect(moveUsageEntry(layout, ['a', 'b'], 'b', 'down')).toBe(layout);
    expect(moveUsageEntry(layout, ['a', 'b'], 'zzz', 'down')).toBe(layout);
  });
});

describe('hide and show', () => {
  test('hide is idempotent and show removes the id', () => {
    const hidden = hideUsageEntry(hideUsageEntry({ order: [], hidden: [] }, 'a'), 'a');
    expect(hidden.hidden).toEqual(['a']);
    expect(showUsageEntry(hidden, 'a').hidden).toEqual([]);
  });
});

describe('storage', () => {
  beforeEach(() => { localStorage.clear(); });

  test('round-trips and drops malformed entries', () => {
    saveUsageLayout({ order: ['b', 'a'], hidden: ['c'] });
    expect(loadUsageLayout()).toEqual({ order: ['b', 'a'], hidden: ['c'] });
    localStorage.setItem(USAGE_LAYOUT_KEY, JSON.stringify({ order: ['a', 3, ''], hidden: 'x' }));
    expect(loadUsageLayout()).toEqual({ order: ['a'], hidden: [] });
    localStorage.setItem(USAGE_LAYOUT_KEY, '{not json');
    expect(loadUsageLayout()).toEqual({ order: [], hidden: [] });
  });

  test('an empty layout clears the key', () => {
    saveUsageLayout({ order: ['a'], hidden: [] });
    saveUsageLayout({ order: [], hidden: [] });
    expect(localStorage.getItem(USAGE_LAYOUT_KEY)).toBeNull();
  });
});
