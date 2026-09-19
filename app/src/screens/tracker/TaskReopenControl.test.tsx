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
vi.mock('../../queries/task-reopen', () => ({
  useReopenTask: () => state.mutation,
}));
import { TaskReopenControl } from './TaskReopenControl';
const props = { taskId: 17, status: 'completed' as const, kind: 'task' };
beforeEach(() => {
  state.capability = true;
  state.mutation.mutateAsync.mockReset().mockResolvedValue({});
});
it('hides control without authority, before evaluation and on Umbrellas', () => {
  state.capability = false;
  const view = render(<TaskReopenControl {...props} />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  state.capability = true;
  view.rerender(<TaskReopenControl {...props} status="in_progress" />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  view.rerender(<TaskReopenControl {...props} kind="umbrella" />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it('requires a trimmed note, sends feedback and announces success accessibly', async () => {
  const user = userEvent.setup();
  const { container } = render(<TaskReopenControl {...props} />);
  await user.click(screen.getByRole('button', { name: 'Redeschide taskul' }));
  await user.click(
    screen.getByRole('button', { name: 'Confirmă redeschiderea' }),
  );
  expect(state.mutation.mutateAsync).not.toHaveBeenCalled();
  await user.type(
    screen.getByLabelText('Motiv (obligatoriu)'),
    '  Adaugă sursele  ',
  );
  expect((await axe.run(container)).violations).toEqual([]);
  await user.click(
    screen.getByRole('button', { name: 'Confirmă redeschiderea' }),
  );
  expect(state.mutation.mutateAsync).toHaveBeenCalledWith({
    taskId: 17,
    reason: 'Adaugă sursele',
  });
  expect(screen.getByRole('status')).toHaveTextContent(
    'punctele au fost actualizate',
  );
});
it('keeps feedback on conflict and suppresses duplicate submissions', async () => {
  const user = userEvent.setup();
  state.mutation.mutateAsync.mockRejectedValueOnce(
    new Error('Taskul s-a schimbat.'),
  );
  render(<TaskReopenControl {...props} />);
  await user.click(screen.getByRole('button', { name: 'Redeschide taskul' }));
  await user.type(screen.getByLabelText('Motiv (obligatoriu)'), 'Surse');
  await user.click(
    screen.getByRole('button', { name: 'Confirmă redeschiderea' }),
  );
  expect(screen.getByRole('alert')).toHaveTextContent('s-a schimbat');
  expect(screen.getByLabelText('Motiv (obligatoriu)')).toHaveValue('Surse');
  state.mutation.mutateAsync.mockReturnValue(new Promise(() => {}));
  await user.dblClick(
    screen.getByRole('button', { name: 'Confirmă redeschiderea' }),
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
  const view = render(<TaskReopenControl {...props} />);
  await user.click(screen.getByRole('button', { name: 'Redeschide taskul' }));
  await user.type(
    screen.getByLabelText('Motiv (obligatoriu)'),
    'Motiv justificat',
  );
  await user.click(
    screen.getByRole('button', { name: 'Confirmă redeschiderea' }),
  );
  view.rerender(<TaskReopenControl {...props} status="in_progress" />);
  await act(async () => finish());
  expect(screen.getByRole('status')).toHaveTextContent(
    'punctele au fost actualizate',
  );
  expect(screen.getByRole('status')).toHaveFocus();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
