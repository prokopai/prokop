// Renders every story once. A redesign change that throws during render for
// any surface fails here instead of in a user's browser.
//
// Stories that cannot run under happy-dom (xterm, Pierre web components,
// Mermaid, ResizeObserver-driven virtualization) opt out with
// `parameters: { smoke: 'skip: <reason>' }` on the story or its meta.

import type { ComponentType } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { composeStories, setProjectAnnotations } from '@storybook/react-vite';
import type { Meta } from '@storybook/react-vite';
import preview from '../../.storybook/preview';

setProjectAnnotations([preview]);

// No network in the smoke run: version checks and pairing requests reject at
// once instead of hanging until happy-dom aborts them at teardown.
vi.stubGlobal('fetch', () => Promise.reject(new Error('fetch is disabled in the story smoke test')));

type StoryModule = { default: Meta } & Record<string, unknown>;
type ComposedStory = ComponentType & { parameters: Record<string, unknown> };

const modules = import.meta.glob<StoryModule>('../../src/**/*.stories.tsx', { eager: true });

afterEach(cleanup);

for (const [path, module] of Object.entries(modules)) {
  const title = module.default?.title ?? path;
  const stories = Object.entries(composeStories(module as never)) as Array<[string, ComposedStory]>;

  describe(title, () => {
    for (const [name, Story] of stories) {
      const smoke = Story.parameters.smoke;
      if (typeof smoke === 'string' && smoke.startsWith('skip')) {
        test.skip(`${name} (${smoke})`, () => {});
        continue;
      }
      test(name, async () => {
        const { container } = render(<Story />);
        expect(container).toBeTruthy();
      });
    }
  });
}
