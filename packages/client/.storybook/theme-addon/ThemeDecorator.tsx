import { useEffect } from 'react';
import { useGlobals } from 'storybook/preview-api';
import type { StoryContext } from 'storybook/internal/csf';
import { THEME_MODES, THEME_SCHEMES, THEME_SURFACES } from './constants';
import type { StorybookThemeMode, StorybookThemeScheme, StorybookThemeSurface } from './constants';

function isValidMode(value: string): value is StorybookThemeMode {
  return THEME_MODES.includes(value as StorybookThemeMode);
}

function isValidScheme(value: string): value is StorybookThemeScheme {
  return THEME_SCHEMES.includes(value as StorybookThemeScheme);
}

function isValidSurface(value: string): value is StorybookThemeSurface {
  return THEME_SURFACES.includes(value as StorybookThemeSurface);
}

export function ThemeDecorator(Story: React.ComponentType, _context: StoryContext) {
  const [globals] = useGlobals();

  const mode = isValidMode(globals.themeMode) ? globals.themeMode : 'dark';
  const scheme = isValidScheme(globals.themeScheme) ? globals.themeScheme : 'neutral';
  const surface = isValidSurface(globals.themeSurface) ? globals.themeSurface : 'graphite';

  useEffect(() => {
    const root = document.documentElement;

    // Remove all theme classes
    root.classList.remove('light', 'dark');
    root.classList.remove(...THEME_SCHEMES);
    root.classList.remove(...THEME_SURFACES.map((s) => `surface-${s}`));

    // Apply current theme classes: mode, accent, and the surface unless it is graphite
    root.classList.add(mode);
    root.classList.add(scheme);
    if (surface !== 'graphite') root.classList.add(`surface-${surface}`);
  }, [mode, scheme, surface]);

  return <Story />;
}
