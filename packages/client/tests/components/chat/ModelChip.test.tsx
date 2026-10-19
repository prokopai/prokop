import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { ModelChip } from '@/components/chat/ModelChip';
import type { ModelChoice, ModelGroup, ModelSelection } from '@/hooks/useSessionModelSelection';

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));

// Prokop and Codex expose a model with the same id; the chip must keep them apart.
const prokop: ModelChoice = { harness: 'prokop', key: 'provider:shared', modelId: 'shared', providerId: 'provider', providerName: 'Provider', name: 'Provider Model', efforts: [], defaultEffort: null };
const codex: ModelChoice = { harness: 'codex-cli', key: 'shared', modelId: 'shared', name: 'Codex Model', efforts: ['medium', 'high'], defaultEffort: 'medium' };
const opus: ModelChoice = { harness: 'claude-cli', key: 'claude-opus-5', modelId: 'claude-opus-5', name: 'Opus 5', efforts: ['low', 'medium', 'high'], defaultEffort: 'high' };
const sonnet: ModelChoice = { harness: 'claude-cli', key: 'claude-sonnet-5', modelId: 'claude-sonnet-5', name: 'Sonnet 5', efforts: ['low', 'medium', 'high'], defaultEffort: 'high' };

const groups: ModelGroup[] = [
  { harness: 'prokop', label: 'Prokop', models: [prokop] },
  { harness: 'codex-cli', label: 'Codex', models: [codex] },
  { harness: 'claude-cli', label: 'Claude Code', models: [sonnet, opus] },
];

function chip(props: Partial<React.ComponentProps<typeof ModelChip>> = {}) {
  const onSelectModel = vi.fn();
  const onSelectEffort = vi.fn();
  render(<ModelChip groups={groups} selection={null} onSelectModel={onSelectModel} onSelectEffort={onSelectEffort} {...props} />);
  return { onSelectModel, onSelectEffort };
}

test('the chip names the model and effort without a harness prefix', () => {
  const selection: ModelSelection = { ...opus, effort: 'high' };
  chip({ selection });
  const trigger = screen.getByRole('combobox');
  expect(trigger).toHaveTextContent(/^Opus 5 · high$/);
});

test('harness groups collapse: only the current harness is open until another is picked', async () => {
  const { onSelectModel } = chip({ selection: { ...prokop, effort: null } });
  fireEvent.click(screen.getByRole('combobox'));
  // Prokop is current and open; the Codex row waits closed with the same model id behind it.
  expect(await screen.findByRole('option', { name: /Provider Model/ })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /Codex Model/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('option', { name: /^Codex$/ }));
  fireEvent.click(await screen.findByRole('option', { name: /Codex Model/ }));
  expect(onSelectModel).toHaveBeenCalledWith(codex);
  expect(onSelectModel).not.toHaveBeenCalledWith(prokop);
});

test('an established session lists only its own harness', async () => {
  chip({ selection: { ...codex, effort: 'medium' }, canSwitchHarness: false });
  fireEvent.click(screen.getByRole('combobox'));
  expect(await screen.findByRole('option', { name: /Codex Model/ })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /Prokop/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /Provider Model/ })).not.toBeInTheDocument();
});

test('effort is a row that opens into the selected model\'s levels', async () => {
  const { onSelectEffort } = chip({ selection: { ...codex, effort: 'medium' }, canSwitchHarness: false });
  fireEvent.click(screen.getByRole('combobox'));
  fireEvent.click(await screen.findByRole('button', { name: /Effort/ }));
  fireEvent.click(await screen.findByRole('radio', { name: /high/ }));
  expect(onSelectEffort).toHaveBeenCalledWith('high');
});

test('typing flattens every harness and matches harness names', async () => {
  chip({ selection: { ...prokop, effort: null } });
  fireEvent.click(screen.getByRole('combobox'));
  fireEvent.change(await screen.findByPlaceholderText('Search models…'), { target: { value: 'codex' } });
  expect(await screen.findByRole('option', { name: /Codex Model/ })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /Provider Model/ })).not.toBeInTheDocument();
});

test('recent picks sit on top and carry their harness', async () => {
  const { onSelectModel } = chip({ selection: { ...prokop, effort: null }, recent: [opus] });
  fireEvent.click(screen.getByRole('combobox'));
  expect(await screen.findByText('Recent')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('option', { name: /Opus 5/ }));
  expect(onSelectModel).toHaveBeenCalledWith(opus);
});

test('a model pinned by an agent is named on the chip', () => {
  chip({ selection: { ...prokop, effort: null }, pinnedBy: 'Reviewer' });
  expect(screen.getByRole('combobox')).toHaveTextContent(/via Reviewer/);
});
