import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { PromptsPanel } from '@/components/modals/configuration/PromptsPanel';

const mocks = vi.hoisted(() => ({
  prompts: [{ name: 'review', description: 'Review code', content: '# Review' }],
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('@/hooks/queries', () => ({
  usePromptsQuery: () => ({ data: { prompts: mocks.prompts }, isLoading: false }),
  useCreatePrompt: () => ({ mutateAsync: mocks.create }),
  useUpdatePrompt: () => ({ mutateAsync: mocks.update }),
  useDeletePrompt: () => ({ mutateAsync: mocks.remove, isPending: false }),
}));

afterEach(() => vi.clearAllMocks());

describe('PromptsPanel', () => {
  test('creates a prompt and returns to the list', async () => {
    mocks.create.mockResolvedValue({});
    render(<PromptsPanel sdkClient={null} />);
    fireEvent.click(screen.getByRole('button', { name: /New Prompt/ }));
    fireEvent.change(screen.getByPlaceholderText('prompt-name'), { target: { value: ' standup ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith({ name: 'standup', content: '# New Prompt\n\n' }));
    expect(await screen.findByText('review')).toBeInTheDocument();
  });

  test('editing updates the existing prompt by name', async () => {
    mocks.update.mockResolvedValue({});
    render(<PromptsPanel sdkClient={null} />);
    fireEvent.click(screen.getByText('review'));
    fireEvent.change(screen.getByPlaceholderText(/Prompt Title/), { target: { value: '# Review v2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ name: 'review', body: { content: '# Review v2' } }));
  });

  test('delete asks first and removes the chosen prompt', async () => {
    mocks.remove.mockResolvedValue({});
    render(<PromptsPanel sdkClient={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete prompt review' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('delete the prompt "review"');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('review'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
