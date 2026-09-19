import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  capability: true,
  mutation: { isPending: false, mutateAsync: vi.fn() },
}));
vi.mock('../../queries/task-review', () => ({
  useTaskEvaluationCapability: () => ({ data: state.capability }),
}));
vi.mock('../../queries/task-cancel', () => ({
  useCancelTask: () => state.mutation,
}));
import { TaskCancelControl } from './TaskCancelControl';
const props = {
  taskId: 17,
  status: 'in_review' as const,
  kind: 'task',
  canManage: true,
};
beforeEach(() => {
  state.capability = true;
  state.mutation.mutateAsync.mockReset().mockResolvedValue({});
});
it('hides cancellation without management and for terminal Tasks', () => {
  const view = render(<TaskCancelControl {...props} canManage={false} />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  for (const status of ['completed', 'unfulfilled', 'cancelled'] as const) {
    view.rerender(<TaskCancelControl {...props} status={status} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  }
});
it('explains the Umbrella cancellation cascade', async () => {
  const user = userEvent.setup();
  render(<TaskCancelControl {...props} kind="umbrella" />);
  await user.click(screen.getByRole('button', { name: 'Anulează taskul' }));
  expect(
    screen.getByText(/Toate Subtaskurile neterminale/),
  ).toBeInTheDocument();
  expect(screen.getByText(/Anularea păstrează istoricul/)).toBeInTheDocument();
});
it('requires a trimmed note, sends feedback and announces success accessibly', async () => {
  const user = userEvent.setup();
  const { container } = render(<TaskCancelControl {...props} />);
  await user.click(screen.getByRole('button', { name: 'Anulează taskul' }));
  await user.click(screen.getByRole('button', { name: 'Confirmă anularea' }));
  expect(state.mutation.mutateAsync).not.toHaveBeenCalled();
  await user.type(
    screen.getByLabelText('Motiv (obligatoriu)'),
    '  Adaugă sursele  ',
  );
  expect((await axe.run(container)).violations).toEqual([]);
  await user.click(screen.getByRole('button', { name: 'Confirmă anularea' }));
  expect(state.mutation.mutateAsync).toHaveBeenCalledWith({
    taskId: 17,
    reason: 'Adaugă sursele',
  });
  expect(screen.getByRole('status')).toHaveTextContent(
    'Istoricul rămâne păstrat',
  );
});
it('keeps feedback on conflict and suppresses duplicate submissions', async () => {
  const user = userEvent.setup();
  state.mutation.mutateAsync.mockRejectedValueOnce(
    new Error('Taskul s-a schimbat.'),
  );
  render(<TaskCancelControl {...props} />);
  await user.click(screen.getByRole('button', { name: 'Anulează taskul' }));
  await user.type(screen.getByLabelText('Motiv (obligatoriu)'), 'Surse');
  await user.click(screen.getByRole('button', { name: 'Confirmă anularea' }));
  expect(screen.getByRole('alert')).toHaveTextContent('s-a schimbat');
  expect(screen.getByLabelText('Motiv (obligatoriu)')).toHaveValue('Surse');
  state.mutation.mutateAsync.mockReturnValue(new Promise(() => {}));
  await user.dblClick(
    screen.getByRole('button', { name: 'Confirmă anularea' }),
  );
  expect(state.mutation.mutateAsync).toHaveBeenCalledTimes(2);
});

it('announces and focuses success after status refetch before mutation resolves', async () => {
  let finish!: () => void;
  state.mutation.mutateAsync.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const user = userEvent.setup();
  const view = render(<TaskCancelControl {...props} />);
  await user.click(screen.getByRole('button', { name: 'Anulează taskul' }));
  await user.type(
    screen.getByLabelText('Motiv (obligatoriu)'),
    'Motiv justificat',
  );
  await user.click(screen.getByRole('button', { name: 'Confirmă anularea' }));
  view.rerender(<TaskCancelControl {...props} status="cancelled" />);
  await act(async () => finish());
  expect(screen.getByRole('status')).toHaveTextContent(
    'Istoricul rămâne păstrat',
  );
  expect(screen.getByRole('status')).toHaveFocus();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
