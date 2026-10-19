import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { syncThemeColor } from '@/lib/desktopChrome';

export type ThemeMode = 'light' | 'dark' | 'system';
/** Accent ids keep their historical names; see ACCENT_LABELS for what they mean now. */
export type ThemeScheme = 'neutral' | 'ocean' | 'forest' | 'sunset' | 'amethyst';
export type ThemeSurface = 'graphite' | 'warm' | 'ocean' | 'moss' | 'mauve' | 'carbon';

export const THEME_SCHEMES: ThemeScheme[] = ['neutral', 'ocean', 'forest', 'sunset', 'amethyst'];
export const THEME_SURFACES: ThemeSurface[] = ['graphite', 'warm', 'ocean', 'moss', 'mauve', 'carbon'];
export const SURFACE_LABELS: Record<ThemeSurface, string> = {
  graphite: 'Graphite',
  warm: 'Warm',
  ocean: 'Ocean',
  moss: 'Moss',
  mauve: 'Mauve',
  carbon: 'Carbon',
};
/**
 * Settings saved before surfaces existed name one of the five old tinted
 * schemes. Each becomes the nearest accent on the nearest surface, so an
 * Ocean user keeps a blue accent on blue-gray panels instead of waking up to
 * teal on graphite. Applied once; the result is saved with a surface.
 */
export function migrateTintedScheme(settings: ThemeSettings): ThemeSettings {
  if (settings.surface) return settings;
  const map: Record<ThemeScheme, { scheme: ThemeScheme; surface: ThemeSurface }> = {
    neutral: { scheme: 'neutral', surface: 'graphite' },
    ocean: { scheme: 'neutral', surface: 'ocean' },
    forest: { scheme: 'forest', surface: 'moss' },
    sunset: { scheme: 'sunset', surface: 'warm' },
    amethyst: { scheme: 'amethyst', surface: 'mauve' },
  };
  const next = map[settings.scheme] ?? map.neutral;
  return { mode: settings.mode, ...next };
}
/** The class a surface puts on the root; graphite is the base and needs none. */
export function surfaceClass(surface: ThemeSurface): string | null {
  return surface === 'graphite' ? null : `surface-${surface}`;
}
export const ACCENT_LABELS: Record<ThemeScheme, string> = {
  neutral: 'Blue',
  ocean: 'Teal',
  forest: 'Green',
  sunset: 'Amber',
  amethyst: 'Violet',
};

interface ThemeSettings {
  mode: ThemeMode;
  scheme: ThemeScheme;
  surface?: ThemeSurface;
}

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultMode?: ThemeMode;
  defaultScheme?: ThemeScheme;
  storageKey?: string;
}

interface ThemeProviderState {
  mode: ThemeMode;
  scheme: ThemeScheme;
  surface: ThemeSurface;
  setMode: (mode: ThemeMode) => void;
  setScheme: (scheme: ThemeScheme) => void;
  setSurface: (surface: ThemeSurface) => void;
  resolvedMode: 'dark' | 'light';
}

const LEGACY_STORAGE_KEY = 'jean2-theme';
const DEFAULT_SCHEME: ThemeScheme = 'neutral';
const DEFAULT_SURFACE: ThemeSurface = 'graphite';
const DEFAULT_MODE: ThemeMode = 'system';

const initialState: ThemeProviderState = {
  mode: DEFAULT_MODE,
  scheme: DEFAULT_SCHEME,
  surface: DEFAULT_SURFACE,
  setMode: () => null,
  setScheme: () => null,
  setSurface: () => null,
  resolvedMode: 'dark',
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

function getSystemTheme(): 'dark' | 'light' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getResolvedMode(mode: ThemeMode): 'dark' | 'light' {
  if (mode === 'system') {
    return getSystemTheme();
  }
  return mode;
}

function migrateLegacyTheme(storageKey: string): ThemeSettings | null {
  const legacyValue = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!legacyValue) return null;

  const validModes: ThemeMode[] = ['light', 'dark', 'system'];
  if (!validModes.includes(legacyValue as ThemeMode)) return null;

  const settings: ThemeSettings = {
    mode: legacyValue as ThemeMode,
    scheme: DEFAULT_SCHEME,
  };

  localStorage.setItem(storageKey, JSON.stringify(settings));
  localStorage.removeItem(LEGACY_STORAGE_KEY);

  return settings;
}

export function ThemeProvider({
  children,
  defaultMode = DEFAULT_MODE,
  defaultScheme = DEFAULT_SCHEME,
  storageKey = 'prokopai-theme-settings',
  ...props
}: ThemeProviderProps) {
  const [settings, setSettings] = useState<ThemeSettings>(() => {
    const migrated = migrateLegacyTheme(storageKey);
    if (migrated) return migrated;

    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as ThemeSettings;
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          'mode' in parsed &&
          'scheme' in parsed
        ) {
          const migrated = migrateTintedScheme(parsed);
          if (migrated !== parsed) localStorage.setItem(storageKey, JSON.stringify(migrated));
          return migrated;
        }
      } catch {
        // Invalid JSON, use defaults
      }
    }

    return { mode: defaultMode, scheme: defaultScheme, surface: DEFAULT_SURFACE };
  });

  const [resolvedMode, setResolvedMode] = useState<'dark' | 'light'>(() =>
    getResolvedMode(settings.mode)
  );

  const applyThemeClasses = useCallback((mode: ThemeMode, scheme: ThemeScheme, surface: ThemeSurface) => {
    const root = window.document.documentElement;
    const resolved = getResolvedMode(mode);

    root.classList.remove('light', 'dark');
    root.classList.remove(...THEME_SCHEMES);
    root.classList.remove(...THEME_SURFACES.map((s) => `surface-${s}`));

    root.classList.add(resolved);
    root.classList.add(scheme);
    const surfaceClassName = surfaceClass(surface);
    if (surfaceClassName) root.classList.add(surfaceClassName);
    syncThemeColor(`${resolved}.${scheme}.${surface}`);

    setResolvedMode(resolved);
  }, []);

  const surface = settings.surface ?? DEFAULT_SURFACE;

  useEffect(() => {
    applyThemeClasses(settings.mode, settings.scheme, surface);
  }, [settings, surface, applyThemeClasses]);

  useEffect(() => {
    if (settings.mode !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = () => {
      applyThemeClasses(settings.mode, settings.scheme, surface);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [settings.mode, settings.scheme, surface, applyThemeClasses]);

  const setMode = useCallback(
    (mode: ThemeMode) => {
      const newSettings = { ...settings, mode };
      setSettings(newSettings);
      localStorage.setItem(storageKey, JSON.stringify(newSettings));
    },
    [settings, storageKey]
  );

  const setScheme = useCallback(
    (scheme: ThemeScheme) => {
      const newSettings = { ...settings, scheme };
      setSettings(newSettings);
      localStorage.setItem(storageKey, JSON.stringify(newSettings));
    },
    [settings, storageKey]
  );

  const setSurface = useCallback(
    (surface: ThemeSurface) => {
      const newSettings = { ...settings, surface };
      setSettings(newSettings);
      localStorage.setItem(storageKey, JSON.stringify(newSettings));
    },
    [settings, storageKey]
  );

  const value: ThemeProviderState = {
    mode: settings.mode,
    scheme: settings.scheme,
    surface,
    setMode,
    setScheme,
    setSurface,
    resolvedMode,
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined)
    throw new Error('useTheme must be used within a ThemeProvider');

  return context;
};
