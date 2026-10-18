import type { StorybookConfig } from '@storybook/react-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

const config: StorybookConfig = {
  stories: [
    '../src/**/*.stories.tsx',
  ],
  addons: [
    './theme-addon/preset.ts',
  ],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  viteFinal: async (config) => {
    // Storybook inherits vite.config.ts. Drop the plugins that only make sense
    // for the app bundle:
    // - TanStack Router: stories mount a memory router when they need one.
    // - vite-plugin-pwa: a service worker precache manifest rejects Storybook's
    //   manager chunk (over 2 MiB) and fails the build.
    // - the project React plugin: we add our own below; two copies throw
    //   "RefreshRuntime already declared".
    const existingPlugins = (config.plugins ?? []).flatMap((plugin) =>
      Array.isArray(plugin) ? plugin : [plugin],
    ).filter((plugin) => {
      if (plugin && typeof plugin === 'object' && 'name' in plugin) {
        const name = (plugin as { name: string }).name.toLowerCase();
        return !name.includes('tanstack')
          && !name.includes('router')
          && !name.includes('pwa')
          && !name.startsWith('vite:react');
      }
      return true;
    });

    config.plugins = [
      react(),
      tailwindcss(),
      ...existingPlugins,
    ];

    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': path.resolve(import.meta.dirname, '../src'),
    };

    config.optimizeDeps = config.optimizeDeps || {};
    config.optimizeDeps.include = [
      '@prokopai/sdk',
    ];

    return config;
  },
};

export default config;
