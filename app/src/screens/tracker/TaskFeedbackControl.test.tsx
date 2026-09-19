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
vi.mock('../../queries/task-feedback', () => ({
  useReturnTaskToProgress: () => state.mutation,
}));
import { TaskFeedbackControl } from './TaskFeedbackControl';
const props = { taskId: 17, status: 'in_review' as const, kind: 'task' };
beforeEach(() => {
  state.capability = true;
  state.mutation.mutateAsync.mockReset().mockResolvedValue({});
});
it('hides control without authority, outside review and on Umbrellas', () => {
  state.capability = false;
  const view = render(<TaskFeedbackControl {...props} />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  state.capability = true;
  view.rerender(<TaskFeedbackControl {...props} status="in_progress" />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  view.rerender(<TaskFeedbackControl {...props} kind="umbrella" />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it('requires a trimmed note, sends feedback and announces success accessibly', async () => {
  const user = userEvent.setup();
  const { container } = render(<TaskFeedbackControl {...props} />);
  await user.click(
    screen.getByRole('button', { name: 'Trimite înapoi în lucru' }),
  );
  await user.click(screen.getByRole('button', { name: 'Confirmă feedbackul' }));
  expect(state.mutation.mutateAsync).not.toHaveBeenCalled();
  await user.type(
    screen.getByLabelText('Notă pentru Executor (obligatoriu)'),
    '  Adaugă sursele  ',
  );
  expect((await axe.run(container)).violations).toEqual([]);
  await user.click(screen.getByRole('button', { name: 'Confirmă feedbackul' }));
  expect(state.mutation.mutateAsync).toHaveBeenCalledWith({
    taskId: 17,
    note: 'Adaugă sursele',
  });
  expect(screen.getByRole('status')).toHaveTextContent('feedback de aplicat');
});
it('keeps feedback on conflict and suppresses duplicate submissions', async () => {
  const user = userEvent.setup();
  state.mutation.mutateAsync.mockRejectedValueOnce(
    new Error('Taskul s-a schimbat.'),
  );
  render(<TaskFeedbackControl {...props} />);
  await user.click(
    screen.getByRole('button', { name: 'Trimite înapoi în lucru' }),
  );
  await user.type(
    screen.getByLabelText('Notă pentru Executor (obligatoriu)'),
    'Surse',
  );
  await user.click(screen.getByRole('button', { name: 'Confirmă feedbackul' }));
  expect(screen.getByRole('alert')).toHaveTextContent('s-a schimbat');
  expect(
    screen.getByLabelText('Notă pentru Executor (obligatoriu)'),
  ).toHaveValue('Surse');
  state.mutation.mutateAsync.mockReturnValue(new Promise(() => {}));
  await user.dblClick(
    screen.getByRole('button', { name: 'Confirmă feedbackul' }),
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
  const view = render(<TaskFeedbackControl {...props} />);
  await user.click(
    screen.getByRole('button', { name: 'Trimite înapoi în lucru' }),
  );
  await user.type(
    screen.getByLabelText('Notă pentru Executor (obligatoriu)'),
    'Motiv justificat',
  );
  await user.click(screen.getByRole('button', { name: 'Confirmă feedbackul' }));
  view.rerender(<TaskFeedbackControl {...props} status="in_progress" />);
  await act(async () => finish());
  expect(screen.getByRole('status')).toHaveTextContent('feedback de aplicat');
  expect(screen.getByRole('status')).toHaveFocus();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  view.rerender(<TaskFeedbackControl {...props} />);
  expect(
    screen.getByRole('button', { name: 'Trimite înapoi în lucru' }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it('preserves success when mutation resolves before status refetch before mutation resolves', async () => {
  let finish!: () => void;
  state.mutation.mutateAsync.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const user = userEvent.setup();
  const view = render(<TaskFeedbackControl {...props} />);
  await user.click(
    screen.getByRole('button', { name: 'Trimite înapoi în lucru' }),
  );
  await user.type(
    screen.getByLabelText('Notă pentru Executor (obligatoriu)'),
    'Motiv justificat',
  );
  await user.click(screen.getByRole('button', { name: 'Confirmă feedbackul' }));
  await act(async () => finish());
  view.rerender(<TaskFeedbackControl {...props} status="in_progress" />);
  expect(screen.getByRole('status')).toHaveTextContent('feedback de aplicat');
  expect(screen.getByRole('status')).toHaveFocus();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  view.rerender(<TaskFeedbackControl {...props} />);
  expect(
    screen.getByRole('button', { name: 'Trimite înapoi în lucru' }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
