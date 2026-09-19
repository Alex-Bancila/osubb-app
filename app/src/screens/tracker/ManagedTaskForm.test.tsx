import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ query: vi.fn(), refetch: vi.fn() }));
vi.mock('../../queries/task-form-options', () => ({
  useTaskFormOptions: state.query,
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
import { ManagedTaskForm } from './ManagedTaskForm';
it('distinguishes loading, safe retryable failures, and no managed origins', async () => {
  state.query.mockReturnValue({ isPending: true });
  const view = render(<ManagedTaskForm onDraft={vi.fn()} />);
  expect(screen.getByRole('status')).toHaveTextContent('Se încarcă');
  state.query.mockReturnValue({
    isError: true,
    error: new Error('internal detail'),
    refetch: state.refetch,
  });
  view.rerender(<ManagedTaskForm onDraft={vi.fn()} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Nu am putut încărca');
  expect(screen.queryByText('internal detail')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Reîncearcă' }));
  expect(state.refetch).toHaveBeenCalledOnce();
  state.query.mockReturnValue({
    data: { groups: [], campaigns: [], umbrellas: [] },
  });
  view.rerender(<ManagedTaskForm onDraft={vi.fn()} />);
  expect(
    screen.getByText('Nu ai grupuri în care poți pregăti taskuri.'),
  ).toBeInTheDocument();
});
