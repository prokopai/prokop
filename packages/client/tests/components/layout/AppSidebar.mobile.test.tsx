import { render } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { AppSidebar } from '@/components/layout/AppSidebar';

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => true,
}));

describe('AppSidebar on phone', () => {
  test('renders the same in-flow list; the Sessions surface is chosen by the workspace views', () => {
    const { container, getByText } = render(
      <AppSidebar currentSessionId={null}>
        <button type="button" data-sidebar="menu-button">
          Session one
        </button>
      </AppSidebar>,
    );

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[data-sidebar="sidebar"]')).toContainElement(getByText('Session one'));
  });
});
