import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { ProkopaiClient, Session } from '@prokopai/sdk';
import { AutoApproveSelector } from '@/components/chat/AutoApproveSelector';
import { useSessionStore } from '@/stores/sessionStore';

const originalSessions = useSessionStore.getState().sessions;
afterEach(() => { useSessionStore.setState({ sessions: originalSessions }); });

test('permission shield persists the chosen mode and reflects the server reply', async () => {
  const session = { id: 's1', harness: 'prokop', permissionMode: 'standard' } as Session;
  useSessionStore.setState({ sessions: [session] });
  const update = vi.fn().mockResolvedValue({ session: { ...session, permissionMode: 'extended' } });
  const client = { http: { sessions: { update } } } as unknown as ProkopaiClient;
  render(<AutoApproveSelector sessionId="s1" sdkClient={client} />);
  await act(async () => {
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Standard permissions' }),
      { button: 0, ctrlKey: false, pointerType: 'mouse' });
  });
  await act(async () => {
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Extended' }));
  });
  await waitFor(() => expect(update).toHaveBeenCalledWith('s1', { permissionMode: 'extended' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Extended permissions' })).toBeInTheDocument());
});

test('disabled shield still names the current mode without a menu', () => {
  const session = { id: 's2', harness: 'prokop', permissionMode: 'full' } as Session;
  useSessionStore.setState({ sessions: [session] });
  render(<AutoApproveSelector sessionId="s2" sdkClient={null} disabled />);
  const button = screen.getByRole('button', { name: 'Full access permissions' });
  expect(button).toBeDisabled();
  expect(button).not.toHaveAttribute('aria-haspopup');
});
