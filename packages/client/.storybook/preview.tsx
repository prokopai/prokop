import { useState, type ComponentType } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeDecorator } from './theme-addon/ThemeDecorator';
import { THEME_MODES, THEME_SCHEMES, SCHEME_LABELS } from './theme-addon/constants';
import { resetAllStores } from './mocks/storeCleanup';
import { ServerClientProvider, type ServerClientValue } from '../src/contexts/ServerClientContext';
import '../src/index.css';

// Global decorator: components under a session (tool rows, transcript) read the
// server client from context; stories have no server, so provide an offline one.
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

export default {
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
    options: {
      storySort: {
        method: 'alphabetical',
        order: [
          'UI Primitives',
          'Shared',
          'Visualizations',
          'Chat',
          'Layout',
          'Modals',
          'Composite',
        ],
      },
    },
  },
};
