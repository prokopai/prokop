import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { WorkspaceDock } from '@/components/app/WorkspaceDock';
import { useDockStore } from '@/stores/dockStore';

describe('WorkspaceDock', () => {
  beforeEach(() => {
    useDockStore.setState(useDockStore.getInitialState());
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    useDockStore.setState(useDockStore.getInitialState());
  });

  test('keeps only the side dock opened last when the row cannot hold both', async () => {
    let width = 800;
    let notifyResize = () => {};
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { notifyResize = callback; }
      observe() {}
      disconnect() {}
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return new DOMRect(0, 0, this.dataset.slot === 'workspace-dock-row' ? width : 0, 800);
    });
    render(<WorkspaceDock center={<span>Conversation</span>} />);
    expect(useDockStore.getState().docks.left.open).toBe(true);

    // 220 + 300 + 360 + 24 = 904 does not fit in 800: opening right closes left.
    act(() => useDockStore.getState().toggleDock('right'));
    expect(useDockStore.getState().docks.right.open).toBe(true);
    expect(useDockStore.getState().docks.left.open).toBe(false);

    // Opening left again closes right.
    act(() => useDockStore.getState().setDockOpen('left', true));
    expect(useDockStore.getState().docks.left.open).toBe(true);
    expect(useDockStore.getState().docks.right.open).toBe(false);

    // A wide row holds both; shrinking it closes the older one.
    width = 1400;
    act(() => notifyResize());
    act(() => useDockStore.getState().setDockOpen('right', true));
    expect(useDockStore.getState().docks.left.open).toBe(true);
    expect(useDockStore.getState().docks.right.open).toBe(true);
    width = 800;
    act(() => notifyResize());
    await vi.waitFor(() => expect(useDockStore.getState().docks.left.open).toBe(false));
    expect(useDockStore.getState().docks.right.open).toBe(true);
  });

  test('places left beside the center, right beside center, and bottom below both', () => {
    const { getByTestId } = render(
      <WorkspaceDock
        left={<div data-testid="left" />}
        center={<div data-testid="center" />}
        right={<div data-testid="right" />}
        bottom={<div data-testid="bottom" />}
      />,
    );
    const left = getByTestId('left');
    const center = getByTestId('center');
    const right = getByTestId('right');
    const bottom = getByTestId('bottom');
    const centerRow = center.parentElement;
    const primary = centerRow?.parentElement;

    expect(centerRow).toHaveAttribute('data-slot', 'workspace-center-row');
    expect(right.parentElement).toBe(centerRow);
    expect(bottom.parentElement).toBe(primary);
    expect(left.parentElement).toBe(primary?.parentElement);
    expect((centerRow?.compareDocumentPosition(bottom) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(primary).not.toContainElement(left);
  });

  test('supports a center without peripheral docks', () => {
    const { getByRole, getByText } = render(<WorkspaceDock center={<span>Conversation</span>} />);
    expect(getByRole('main')).toContainElement(getByText('Conversation'));
    expect(getByRole('main')).toHaveClass('min-h-0', 'min-w-0', 'overflow-hidden');
  });
});
