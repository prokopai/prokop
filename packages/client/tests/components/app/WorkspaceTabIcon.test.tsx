import { render } from '@testing-library/react';
import { expect, test } from 'vitest';
import { WorkspaceTabIcon } from '@/components/app/WorkspaceTabIcon';
import { fileViewId, pullRequestsViewId, sessionViewId, settingsViewId, WORKSPACE_VIEW_IDS } from '@/stores/workspaceViewStore';

// Every view kind the tab strip can show must have an icon, or the strip throws on render.
test.each([
  ...WORKSPACE_VIEW_IDS,
  sessionViewId('s1', 'sess-1'),
  fileViewId('doc-1'),
  pullRequestsViewId('s1', 'ws-1'),
  settingsViewId('s1'),
])('renders an icon for %s', (id) => {
  const { container } = render(<WorkspaceTabIcon id={id} />);
  expect(container.querySelector('svg')).not.toBeNull();
});
