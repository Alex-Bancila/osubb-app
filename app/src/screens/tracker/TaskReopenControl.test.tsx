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
vi.mock('../../queries/task-reopen', () => ({
  useReopenTask: () => state.mutation,
}));
import { TaskReopenControl } from './TaskReopenControl';
const props = { taskId: 17, status: 'completed' as const, kind: 'task' };
const noteLabel = 'Motiv (obligatoriu)';
beforeEach(() => {
  state.capability = true;
  state.mutation.mutateAsync.mockReset().mockResolvedValue({});
});
async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Redeschide taskul' }));
  return screen.findByRole('dialog', { name: 'Redeschide taskul' });
}
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
it('opens a titled pop-up, requires a trimmed reason, reopens and announces success', async () => {
  const user = userEvent.setup();
  render(<TaskReopenControl {...props} />);
  const dialog = await openDialog(user);
  expect(dialog).toHaveAccessibleDescription(
    /Punctele evaluării sunt inversate/,
  );
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirmă redeschiderea' }),
  );
  expect(state.mutation.mutateAsync).not.toHaveBeenCalled();
  expect(within(dialog).getByRole('alert')).toHaveTextContent('Scrie motivul.');
  await user.type(
    within(dialog).getByLabelText(noteLabel),
    '  Adaugă sursele  ',
  );
  const results = await axe.run(dialog, {
    rules: { 'color-contrast': { enabled: false } },
  });
  expect(results.violations).toEqual([]);
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirmă redeschiderea' }),
  );
  expect(state.mutation.mutateAsync).toHaveBeenCalledWith({
    taskId: 17,
    reason: 'Adaugă sursele',
  });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('status')).toHaveTextContent(
    'punctele au fost actualizate',
  );
  expect(screen.getByRole('status')).toHaveFocus();
});
it('closes with Escape without sending and returns focus to the trigger', async () => {
  const user = userEvent.setup();
  render(<TaskReopenControl {...props} />);
  const trigger = screen.getByRole('button', {
    name: 'Redeschide taskul',
  });
  await openDialog(user);
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(trigger).toHaveFocus();
  expect(state.mutation.mutateAsync).not.toHaveBeenCalled();
});
it('keeps the reason inside the pop-up on conflict and suppresses duplicate submissions', async () => {
  const user = userEvent.setup();
  state.mutation.mutateAsync.mockRejectedValueOnce(
    new CommandError(null, 'Taskul s-a schimbat.'),
  );
  render(<TaskReopenControl {...props} />);
  const dialog = await openDialog(user);
  await user.type(within(dialog).getByLabelText(noteLabel), 'Surse');
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirmă redeschiderea' }),
  );
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    's-a schimbat',
  );
  expect(within(dialog).getByLabelText(noteLabel)).toHaveValue('Surse');
  state.mutation.mutateAsync.mockReturnValue(new Promise(() => {}));
  await user.dblClick(
    within(dialog).getByRole('button', { name: 'Confirmă redeschiderea' }),
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
  const dialog = await openDialog(user);
  await user.type(within(dialog).getByLabelText(noteLabel), 'Motiv justificat');
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirmă redeschiderea' }),
  );
  view.rerender(<TaskReopenControl {...props} status="in_progress" />);
  await act(async () => finish());
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('status')).toHaveTextContent(
    'punctele au fost actualizate',
  );
  expect(screen.getByRole('status')).toHaveFocus();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  view.rerender(<TaskReopenControl {...props} />);
  expect(
    screen.getByRole('button', { name: 'Redeschide taskul' }),
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
  const view = render(<TaskReopenControl {...props} />);
  const dialog = await openDialog(user);
  await user.type(within(dialog).getByLabelText(noteLabel), 'Motiv justificat');
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirmă redeschiderea' }),
  );
  await act(async () => finish());
  view.rerender(<TaskReopenControl {...props} status="in_progress" />);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('status')).toHaveTextContent(
    'punctele au fost actualizate',
  );
  expect(screen.getByRole('status')).toHaveFocus();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  view.rerender(<TaskReopenControl {...props} />);
  expect(
    screen.getByRole('button', { name: 'Redeschide taskul' }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
