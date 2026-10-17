import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { useSettingsEditor } from '@/components/modals/configuration/useSettingsEditor';

const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

interface Item { id: string; name: string }
const item: Item = { id: '1', name: 'One' };

function setup(overrides: Partial<Parameters<typeof useSettingsEditor<Item, Item>>[0]> = {}) {
  const load = vi.fn();
  const save = vi.fn().mockResolvedValue(undefined);
  const remove = vi.fn().mockResolvedValue(undefined);
  const hook = renderHook(() => useSettingsEditor<Item, Item>({
    load, save, remove, saveError: 'Failed to save', deleteError: 'Failed to delete', ...overrides,
  }));
  return { ...hook, load, save, remove };
}

afterEach(() => toast.error.mockReset());

describe('useSettingsEditor', () => {
  test('opening loads the draft: empty for new, the item for edit', () => {
    const { result, load } = setup();
    act(() => result.current.startCreate());
    expect(load).toHaveBeenLastCalledWith(null);
    expect(result.current.isCreating).toBe(true);
    act(() => result.current.startEdit(item));
    expect(load).toHaveBeenLastCalledWith(item);
    expect(result.current.editing).toBe(item);
    expect(result.current.isCreating).toBe(false);
  });

  test('a successful save closes the editor', async () => {
    const { result, save } = setup();
    act(() => result.current.startEdit(item));
    await act(() => result.current.save());
    expect(save).toHaveBeenCalledWith(item);
    expect(result.current.isOpen).toBe(false);
    expect(result.current.saving).toBe(false);
  });

  test('a save that returns false stays open without an error', async () => {
    const { result } = setup({ save: vi.fn().mockResolvedValue(false) });
    act(() => result.current.startCreate());
    await act(() => result.current.save());
    expect(result.current.isOpen).toBe(true);
    expect(result.current.error).toBeNull();
  });

  test('a failed save stays open and shows the message; reopening clears it', async () => {
    const { result } = setup({ save: vi.fn().mockRejectedValue(new Error('name taken')) });
    act(() => result.current.startCreate());
    await act(() => result.current.save());
    expect(result.current.isOpen).toBe(true);
    expect(result.current.error).toBe('name taken');
    act(() => result.current.startEdit(item));
    expect(result.current.error).toBeNull();
  });

  test('a confirmed delete clears the target; a failed one keeps it and reports', async () => {
    const remove = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('in use'));
    const { result } = setup({ remove });
    act(() => result.current.setDeleteTarget(item));
    await act(() => result.current.confirmDelete());
    expect(remove).toHaveBeenCalledWith(item);
    expect(result.current.deleteTarget).toBeNull();

    act(() => result.current.setDeleteTarget(item));
    await act(() => result.current.confirmDelete());
    expect(result.current.deleteTarget).toBe(item);
    expect(result.current.error).toBe('in use');
    expect(toast.error).toHaveBeenCalledWith('Failed to delete', { description: 'in use' });
  });
});
