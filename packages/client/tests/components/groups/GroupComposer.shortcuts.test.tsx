import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { GroupComposer } from '@/components/groups/GroupComposer';
import { useKeyboardShortcuts, type KeyboardShortcutsConfig } from '@/hooks/useKeyboardShortcuts';
import { useKeybindingStore } from '@/stores/keybindingStore';
import { getComposer } from '../../composerHelpers';

/** The group composer with the app's real keyboard shortcuts listening, as in the shell. */

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  useKeybindingStore.setState({ overrides: {} });
});

const config: KeyboardShortcutsConfig = {
  onFocusLeftDock: vi.fn(), onFocusBottomDock: vi.fn(), onFocusRightDock: vi.fn(), onNewSession: vi.fn(), onToggleViewMode: vi.fn(),
  onCloseFocusedDock: vi.fn(), onFocusChatInput: vi.fn(), onStopStreaming: vi.fn(), onToggleAutoFollow: vi.fn(), onFocusTab: vi.fn(),
  onCycleTab: vi.fn(), onCycleTerminal: vi.fn(), onNewTerminal: vi.fn(), onCloseTerminal: vi.fn(),
};

function Shell() {
  useKeyboardShortcuts(config);
  return <GroupComposer members={[{ agentId: 'a', name: 'A' }, { agentId: 'b', name: 'B' }]} defaultAgentId="a" working onStop={vi.fn()} onSend={vi.fn()} />;
}

function press(target: Element, key: string): void {
  fireEvent.keyDown(target, { key, code: key });
  fireEvent.keyUp(target, { key, code: key });
}

test('double Escape in the group composer reaches the stop command, like in a session composer', () => {
  render(<Shell />);
  const composer = getComposer('Message the group  (@ who should answer)');
  composer.focus();
  press(composer, 'Escape');
  press(composer, 'Escape');
  expect(config.onStopStreaming).toHaveBeenCalledTimes(1);
});
