import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import type { Preconfig } from '@prokopai/sdk';
import { AgentChip } from '@/components/chat/AgentChip';

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));

const preconfigs = [
  { id: 'agent-a', name: 'Agent A', description: 'Does A', model: null, provider: null, isDefault: true },
  { id: 'agent-b', name: 'Agent B', description: 'Does B', model: 'opus', provider: 'anthropic', variant: 'high' },
] as Preconfig[];

test('picking another agent sends its id', async () => {
  const onSelect = vi.fn();
  render(<AgentChip preconfigs={preconfigs} selectedId="agent-a" onSelect={onSelect} />);
  const trigger = screen.getByRole('combobox', { name: /Agent A/ });
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByText('Agent B'));
  expect(onSelect).toHaveBeenCalledWith('agent-b');
});

test('rows show the description and the pinned model', async () => {
  render(<AgentChip preconfigs={preconfigs} selectedId="agent-a" onSelect={vi.fn()} pinnedModelName={(p) => (p.model === 'opus' ? 'Opus 5' : null)} />);
  fireEvent.click(screen.getByRole('combobox'));
  expect(await screen.findByText('Does B · Opus 5 · high')).toBeInTheDocument();
  expect(screen.getByText('default')).toBeInTheDocument();
});

test('a locked chip keeps the agent visible and explains instead of listing', async () => {
  const onSelect = vi.fn();
  render(<AgentChip preconfigs={preconfigs} selectedId="agent-b" locked onSelect={onSelect} />);
  const trigger = screen.getByRole('combobox', { name: /Agent B/ });
  fireEvent.click(trigger);
  expect(await screen.findByText(/belongs to/)).toBeInTheDocument();
  expect(screen.queryByText('Agent A')).not.toBeInTheDocument();
});
