import { render } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { ThemeProvider, migrateTintedScheme } from '@/components/providers/ThemeProvider';

const KEY = 'test-theme-settings';

afterEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
});

describe('theme settings saved before surfaces existed', () => {
  test('each old tinted scheme becomes the nearest accent on the nearest surface', () => {
    expect(migrateTintedScheme({ mode: 'dark', scheme: 'ocean' })).toEqual({ mode: 'dark', scheme: 'neutral', surface: 'ocean' });
    expect(migrateTintedScheme({ mode: 'light', scheme: 'forest' })).toEqual({ mode: 'light', scheme: 'forest', surface: 'moss' });
    expect(migrateTintedScheme({ mode: 'system', scheme: 'sunset' })).toEqual({ mode: 'system', scheme: 'sunset', surface: 'warm' });
    expect(migrateTintedScheme({ mode: 'dark', scheme: 'amethyst' })).toEqual({ mode: 'dark', scheme: 'amethyst', surface: 'mauve' });
    expect(migrateTintedScheme({ mode: 'dark', scheme: 'neutral' })).toEqual({ mode: 'dark', scheme: 'neutral', surface: 'graphite' });
  });

  test('settings that already name a surface are left alone', () => {
    const settings = { mode: 'dark' as const, scheme: 'ocean' as const, surface: 'graphite' as const };
    expect(migrateTintedScheme(settings)).toBe(settings);
  });

  test('the provider migrates once, applies the classes and saves the result', () => {
    localStorage.setItem(KEY, JSON.stringify({ mode: 'dark', scheme: 'ocean' }));
    render(<ThemeProvider storageKey={KEY}><span /></ThemeProvider>);
    const root = document.documentElement.classList;
    expect(root.contains('dark')).toBe(true);
    expect(root.contains('neutral')).toBe(true);
    expect(root.contains('surface-ocean')).toBe(true);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ mode: 'dark', scheme: 'neutral', surface: 'ocean' });
  });

  test('graphite puts no surface class on the root', () => {
    localStorage.setItem(KEY, JSON.stringify({ mode: 'light', scheme: 'forest', surface: 'graphite' }));
    render(<ThemeProvider storageKey={KEY}><span /></ThemeProvider>);
    const classes = [...document.documentElement.classList];
    expect(classes).toContain('forest');
    expect(classes.some((c) => c.startsWith('surface-'))).toBe(false);
  });
});
