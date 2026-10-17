import { createRef } from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { AppSidebar, type AppSidebarHandle } from '@/components/layout/AppSidebar';

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));

function renderSidebar(currentSessionId: string | null = null, onEscape?: () => void) {
  const ref = createRef<AppSidebarHandle>();
  const result = render(
    <AppSidebar ref={ref} currentSessionId={currentSessionId} onEscape={onEscape} header={<div>Header</div>}>
      <button type="button" data-sidebar="menu-button" data-session-id="session-1">
        Session one
      </button>
      <button type="button" data-sidebar="menu-button" data-session-id="session-2">
        Session two
      </button>
    </AppSidebar>,
  );

  return { ref, ...result };
}

describe('AppSidebar', () => {
  test('renders header and sessions in flow; placement belongs to the dock', () => {
    const { container, getByText, getByRole } = renderSidebar();
    const root = container.querySelector('[data-sidebar="sidebar"]');
    expect(root).toContainElement(getByText('Header'));
    expect(root).toContainElement(getByRole('button', { name: 'Session one' }));
    expect(root).not.toHaveAttribute('data-mobile-surface');
    expect(container.querySelector('[data-dock-position]')).toBeNull();
    expect(container.querySelector('[role="separator"]')).toBeNull();
  });

  test('focusSessionPanel focuses the active session, else the first', () => {
    const { ref, getByRole, rerender } = renderSidebar('session-2');
    act(() => ref.current?.focusSessionPanel());
    expect(getByRole('button', { name: 'Session two' })).toHaveFocus();

    rerender(
      <AppSidebar ref={ref} currentSessionId={null}>
        <button type="button" data-sidebar="menu-button" data-session-id="session-1">Session one</button>
        <button type="button" data-sidebar="menu-button" data-session-id="session-2">Session two</button>
      </AppSidebar>,
    );
    act(() => ref.current?.focusSessionPanel());
    expect(getByRole('button', { name: 'Session one' })).toHaveFocus();
  });

  test('arrow keys move between sessions and Escape hands focus back', () => {
    const onEscape = vi.fn();
    const { getByRole } = renderSidebar('session-1', onEscape);
    const first = getByRole('button', { name: 'Session one' });
    const second = getByRole('button', { name: 'Session two' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: 'ArrowDown' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: 'ArrowUp' });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledOnce();
    expect(second).not.toHaveFocus();
  });
});
