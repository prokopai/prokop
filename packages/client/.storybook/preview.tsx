import { useState, type ComponentType } from 'react';
import type { Preview } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeDecorator } from './theme-addon/ThemeDecorator';
import { THEME_MODES, THEME_SCHEMES, SCHEME_LABELS } from './theme-addon/constants';
import { resetAllStores } from './mocks/storeCleanup';
import { ServerClientProvider, type ServerClientValue } from '../src/contexts/ServerClientContext';
import '../src/index.css';

// Global decorator: components under a session (tool rows, transcript) read the
// server client from context; stories have no server, so provide an offline one.
// Stories that need answers from the server wrap themselves in `withSdkClient`.
const OFFLINE_SERVER_CLIENT: ServerClientValue = { sdkClient: null, serverUrl: 'https://storybook.local', apiToken: null, connected: false };
function ServerClientDecorator(Story: ComponentType) {
  return (
    <ServerClientProvider value={OFFLINE_SERVER_CLIENT}>
      <Story />
    </ServerClientProvider>
  );
}

// Global decorator: reset all Zustand stores before each story to prevent state leaking
function StoreCleanupDecorator(Story: ComponentType) {
  resetAllStores();
  return <Story />;
}

// Global decorator: provide TanStack Query context so components using useQuery/useMutation render.
// A fresh QueryClient per story prevents cache leaking between stories.
function QueryClientDecorator(Story: ComponentType) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  }));
  return (
    <QueryClientProvider client={client}>
      <Story />
    </QueryClientProvider>
  );
}

/**
 * App viewports. The shell has one breakpoint (640 px, `lib/viewport.ts`):
 * below it mobile surfaces replace docks. `phone` sits under it, `tablet`
 * just above it, `laptop` is the non-fullscreen 13 inch window.
 */
export const APP_VIEWPORTS = {
  phone: { name: 'Phone 390', styles: { width: '390px', height: '844px' }, type: 'mobile' },
  phoneLandscape: { name: 'Phone landscape 844', styles: { width: '844px', height: '390px' }, type: 'mobile' },
  tablet: { name: 'Tablet 768', styles: { width: '768px', height: '1024px' }, type: 'tablet' },
  laptop: { name: 'Laptop 1280', styles: { width: '1280px', height: '800px' }, type: 'desktop' },
  desktop: { name: 'Desktop 1600', styles: { width: '1600px', height: '1000px' }, type: 'desktop' },
} as const;

/** Section order in the sidebar: bottom of the stack first. */
export const STORY_SECTIONS = [
  'Foundations',
  'Primitives',
  'Shared',
  'Visualizations',
  'Chat',
  'Files & Git',
  'Terminal',
  'Sessions',
  'Workspace',
  'Settings',
  'Dialogs',
  'Shell',
  'Screens',
] as const;

const preview: Preview = {
  decorators: [QueryClientDecorator, ServerClientDecorator, StoreCleanupDecorator, ThemeDecorator],
  globalTypes: {
    themeMode: {
      name: 'Theme Mode',
      description: 'Light or dark mode',
      defaultValue: 'dark',
      toolbar: {
        title: 'Mode',
        icon: 'circlehollow',
        items: [...THEME_MODES],
        dynamicTitle: true,
      },
    },
    themeScheme: {
      name: 'Color Scheme',
      description: 'Color palette',
      defaultValue: 'neutral',
      toolbar: {
        title: 'Scheme',
        icon: 'paintbrush',
        items: THEME_SCHEMES.map((scheme) => ({
          value: scheme,
          title: SCHEME_LABELS[scheme],
        })),
        dynamicTitle: true,
      },
    },
  },
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      disable: true,
    },
    viewport: {
      options: APP_VIEWPORTS,
    },
    options: {
      // Storybook reads this list statically; keep it a literal that matches STORY_SECTIONS.
      storySort: {
        method: 'alphabetical',
        order: [
          'Foundations',
          'Primitives',
          'Shared',
          'Visualizations',
          'Chat',
          'Files & Git',
          'Terminal',
          'Sessions',
          'Workspace',
          'Settings',
          'Dialogs',
          'Shell',
          'Screens',
        ],
      },
    },
  },
};

export default preview;
