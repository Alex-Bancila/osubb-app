import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('../../lib/supabase', () => ({ supabase: { rpc } }));
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'reviewer' } } }),
}));
import { TaskReviewCapabilityNotice } from './TaskReviewCapabilityNotice';
it('shows safe capability errors and retries the actual failed query', async () => {
  rpc
    .mockResolvedValueOnce({
      data: null,
      error: new Error('private server detail'),
    })
    .mockResolvedValueOnce({ data: true, error: null });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <TaskReviewCapabilityNotice taskId={17} />
    </QueryClientProvider>,
  );
  expect(screen.getByRole('status')).toHaveTextContent(
    'Se verifică permisiunile',
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Nu am putut verifica',
  );
  expect(screen.queryByText('private server detail')).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole('button', {
      name: 'Reîncearcă verificarea permisiunilor',
    }),
  );
  await waitFor(() =>
    expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
  );
  expect(rpc).toHaveBeenCalledTimes(2);
  expect(rpc).toHaveBeenLastCalledWith('can_evaluate_task', { p_task_id: 17 });
  client.clear();
});
it('treats a successful denial as empty rather than an error', async () => {
  rpc.mockResolvedValue({ data: false, error: null });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <TaskReviewCapabilityNotice taskId={18} />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(screen.queryByRole('status')).not.toBeInTheDocument(),
  );
  expect(view.container).toBeEmptyDOMElement();
  client.clear();
});
