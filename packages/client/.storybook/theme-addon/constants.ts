export const THEME_MODES = ['light', 'dark'] as const;
/** Accent ids keep their historical names; the labels say what they are now. */
export const THEME_SCHEMES = ['neutral', 'ocean', 'forest', 'sunset', 'amethyst'] as const;
export const THEME_SURFACES = ['graphite', 'warm', 'ocean', 'moss', 'mauve', 'carbon'] as const;

export type StorybookThemeMode = (typeof THEME_MODES)[number];
export type StorybookThemeScheme = (typeof THEME_SCHEMES)[number];
export type StorybookThemeSurface = (typeof THEME_SURFACES)[number];

export const SCHEME_LABELS: Record<StorybookThemeScheme, string> = {
  neutral: 'Blue',
  ocean: 'Teal',
  forest: 'Green',
  sunset: 'Amber',
  amethyst: 'Violet',
};

export const SURFACE_LABELS: Record<StorybookThemeSurface, string> = {
  graphite: 'Graphite',
  warm: 'Warm',
  ocean: 'Ocean',
  moss: 'Moss',
  mauve: 'Mauve',
  carbon: 'Carbon',
};
