import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { beforeEach, expect, it, vi } from 'vitest';
import { CommandError } from '../../lib/command-reasons';
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
const noteLabel = 'Notă pentru Executor (obligatoriu)';
beforeEach(() => {
  state.capability = true;
  state.mutation.mutateAsync.mockReset().mockResolvedValue({});
});
async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole('button', { name: 'Trimite înapoi în lucru' }),
  );
  return screen.findByRole('dialog', { name: 'Trimite înapoi în lucru' });
}
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
it('opens a titled pop-up, requires a trimmed note, sends feedback and announces success', async () => {
  const user = userEvent.setup();
  render(<TaskFeedbackControl {...props} />);
  const dialog = await openDialog(user);
  expect(dialog).toHaveAccessibleDescription(/Nota rămâne în istoric/);
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirmă feedbackul' }),
  );
  expect(state.mutation.mutateAsync).not.toHaveBeenCalled();
  expect(within(dialog).getByRole('alert')).toHaveTextContent('Scrie o notă.');
  await user.type(
    within(dialog).getByLabelText(noteLabel),
    '  Adaugă sursele  ',
  );
  const results = await axe.run(dialog, {
    rules: { 'color-contrast': { enabled: false } },
  });
  expect(results.violations).toEqual([]);
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirmă feedbackul' }),
  );
  expect(state.mutation.mutateAsync).toHaveBeenCalledWith({
    taskId: 17,
    note: 'Adaugă sursele',
  });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('status')).toHaveTextContent('feedback de aplicat');
  expect(screen.getByRole('status')).toHaveFocus();
});
it('closes with Escape without sending and returns focus to the trigger', async () => {
  const user = userEvent.setup();
  render(<TaskFeedbackControl {...props} />);
  const trigger = screen.getByRole('button', {
    name: 'Trimite înapoi în lucru',
  });
  await openDialog(user);
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(trigger).toHaveFocus();
  expect(state.mutation.mutateAsync).not.toHaveBeenCalled();
});
it('keeps feedback inside the pop-up on conflict and suppresses duplicate submissions', async () => {
  const user = userEvent.setup();
  state.mutation.mutateAsync.mockRejectedValueOnce(
    new CommandError(null, 'Taskul s-a schimbat.'),
  );
  render(<TaskFeedbackControl {...props} />);
  const dialog = await openDialog(user);
  await user.type(within(dialog).getByLabelText(noteLabel), 'Surse');
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirmă feedbackul' }),
  );
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    's-a schimbat',
  );
  expect(within(dialog).getByLabelText(noteLabel)).toHaveValue('Surse');
  state.mutation.mutateAsync.mockReturnValue(new Promise(() => {}));
  await user.dblClick(
    within(dialog).getByRole('button', { name: 'Confirmă feedbackul' }),
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
  const dialog = await openDialog(user);
  await user.type(within(dialog).getByLabelText(noteLabel), 'Motiv justificat');
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirmă feedbackul' }),
  );
  view.rerender(<TaskFeedbackControl {...props} status="in_progress" />);
  await act(async () => finish());
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('status')).toHaveTextContent('feedback de aplicat');
  expect(screen.getByRole('status')).toHaveFocus();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  view.rerender(<TaskFeedbackControl {...props} />);
  expect(
    screen.getByRole('button', { name: 'Trimite înapoi în lucru' }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it('preserves success when mutation resolves before status refetch', async () => {
  let finish!: () => void;
  state.mutation.mutateAsync.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const user = userEvent.setup();
  const view = render(<TaskFeedbackControl {...props} />);
  const dialog = await openDialog(user);
  await user.type(within(dialog).getByLabelText(noteLabel), 'Motiv justificat');
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirmă feedbackul' }),
  );
  await act(async () => finish());
  view.rerender(<TaskFeedbackControl {...props} status="in_progress" />);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('status')).toHaveTextContent('feedback de aplicat');
  expect(screen.getByRole('status')).toHaveFocus();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  view.rerender(<TaskFeedbackControl {...props} />);
  expect(
    screen.getByRole('button', { name: 'Trimite înapoi în lucru' }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
