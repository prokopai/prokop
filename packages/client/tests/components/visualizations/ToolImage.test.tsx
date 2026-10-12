import { render } from '@testing-library/react';
import { expect, test } from 'vitest';
import { VisualizationRenderer } from '@/components/visualizations/VisualizationRenderer';
import { ServerClientProvider } from '@/contexts/ServerClientContext';

test('a produced image shows from its attachment URL and opens full size', () => {
  const { container } = render(
    <ServerClientProvider value={{ sdkClient: null, serverUrl: 'http://127.0.0.1:4096', apiToken: null, connected: true }}>
      <VisualizationRenderer visualization={{ type: 'image', url: '/api/sessions/s/attachments/a/content?key=k',
        mimeType: 'image/png', alt: 'a golden retriever' }} />
    </ServerClientProvider>,
  );
  const url = 'http://127.0.0.1:4096/api/sessions/s/attachments/a/content?key=k';
  expect(container.querySelector('img')).toMatchObject({ src: url, alt: 'a golden retriever' });
  expect(container.querySelector('a')).toMatchObject({ href: url, target: '_blank' });
});
