import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  mutation: { isPending: false, mutateAsync: vi.fn() },
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
const reasonLabel = 'Motiv (obligatoriu)';
beforeEach(() => {
  state.mutation.mutateAsync.mockReset().mockResolvedValue({});
});
async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Anulează taskul' }));
  return screen.findByRole('dialog', { name: 'Anulează taskul' });
}
it('hides cancellation without management and for terminal Tasks', () => {
  const view = render(<TaskCancelControl {...props} canManage={false} />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  for (const status of ['completed', 'unfulfilled', 'cancelled'] as const) {
    view.rerender(<TaskCancelControl {...props} status={status} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  }
});
it('explains the Umbrella cancellation cascade inside the pop-up', async () => {
  const user = userEvent.setup();
  render(<TaskCancelControl {...props} kind="umbrella" />);
  const dialog = await openDialog(user);
  expect(
    within(dialog).getByText(/Toate Subtaskurile neterminale/),
  ).toBeInTheDocument();
  expect(dialog).toHaveAccessibleDescription(/Anularea păstrează istoricul/);
});
it('requires a trimmed reason, cancels and announces success accessibly', async () => {
  const user = userEvent.setup();
  render(<TaskCancelControl {...props} />);
  const dialog = await openDialog(user);
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirmă anularea' }),
  );
  expect(state.mutation.mutateAsync).not.toHaveBeenCalled();
  expect(within(dialog).getByRole('alert')).toHaveTextContent(
    'Scrie motivul anulării.',
  );
  await user.type(
    within(dialog).getByLabelText(reasonLabel),
    '  Evenimentul s-a amânat  ',
  );
  const results = await axe.run(dialog, {
    rules: { 'color-contrast': { enabled: false } },
  });
  expect(results.violations).toEqual([]);
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirmă anularea' }),
  );
  expect(state.mutation.mutateAsync).toHaveBeenCalledWith({
    taskId: 17,
    reason: 'Evenimentul s-a amânat',
  });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('status')).toHaveTextContent(
    'Istoricul rămâne păstrat',
  );
  expect(screen.getByRole('status')).toHaveFocus();
});
it('closes with Escape without cancelling and returns focus to the trigger', async () => {
  const user = userEvent.setup();
  render(<TaskCancelControl {...props} />);
  const trigger = screen.getByRole('button', { name: 'Anulează taskul' });
  await openDialog(user);
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(trigger).toHaveFocus();
  expect(state.mutation.mutateAsync).not.toHaveBeenCalled();
});
it('keeps the reason inside the pop-up on conflict and suppresses duplicate submissions', async () => {
  const user = userEvent.setup();
  state.mutation.mutateAsync.mockRejectedValueOnce(
    new Error('Taskul s-a schimbat.'),
  );
  render(<TaskCancelControl {...props} />);
  const dialog = await openDialog(user);
  await user.type(within(dialog).getByLabelText(reasonLabel), 'Surse');
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirmă anularea' }),
  );
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    's-a schimbat',
  );
  expect(within(dialog).getByLabelText(reasonLabel)).toHaveValue('Surse');
  state.mutation.mutateAsync.mockReturnValue(new Promise(() => {}));
  await user.dblClick(
    within(dialog).getByRole('button', { name: 'Confirmă anularea' }),
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
  const dialog = await openDialog(user);
  await user.type(within(dialog).getByLabelText(reasonLabel), 'Motiv');
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirmă anularea' }),
  );
  view.rerender(<TaskCancelControl {...props} status="cancelled" />);
  await act(async () => finish());
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('status')).toHaveTextContent(
    'Istoricul rămâne păstrat',
  );
  expect(screen.getByRole('status')).toHaveFocus();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
