import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import axe from 'axe-core';
import { taskRow } from '../../test/task-fixtures';
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
const state = vi.hoisted(() => ({
  options: vi.fn(),
  refetch: vi.fn(),
  mutate: vi.fn(),
}));
vi.mock('../../queries/task-form-options', () => ({
  useTaskFormOptions: state.options,
}));
vi.mock('../../queries/task-edit', async (original) => ({
  ...(await original<object>()),
  useTaskEdit: () => ({ mutateAsync: state.mutate, isPending: false }),
}));
import { TaskEditControl } from './TaskEditControl';
const data = {
  groups: [{ id: 2, name: 'Echipa', path: [1, 2], min_level: 1 }],
  campaigns: [
    { id: 10, name: 'Părinte', group_id: 1 },
    { id: 11, name: 'Copil', group_id: 2 },
    { id: 12, name: 'Alt grup', group_id: 3 },
  ],
  umbrellas: [],
};
const task = taskRow({
  group_id: 2,
  deadline: '2026-09-20T12:00:37Z',
  campaign_id: 9,
  campaign: { name: 'Istoric' },
});
beforeEach(() => {
  state.options.mockReturnValue({ data, refetch: state.refetch });
  state.refetch.mockResolvedValue({ data, isError: false });
  state.mutate.mockResolvedValue({ id: 1 });
});
it('hides editing for non-managers and every terminal status', () => {
  const view = render(<TaskEditControl task={task} canManage={false} />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  for (const status of ['completed', 'unfulfilled', 'cancelled'] as const) {
    view.rerender(<TaskEditControl task={{ ...task, status }} canManage />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  }
});
it('edits mutable content, preserves exact deadline and inactive current Campaign, and rechecks authority', async () => {
  const user = userEvent.setup();
  const { container } = render(<TaskEditControl task={task} canManage />);
  await user.click(screen.getByRole('button', { name: 'Editează taskul' }));
  expect(
    screen.queryByRole('option', { name: 'Alt grup' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Părinte' })).toBeInTheDocument();
  expect(screen.getByLabelText('Campanie')).toHaveValue('9');
  expect(screen.queryByLabelText('Dificultate')).not.toBeInTheDocument();
  await user.clear(screen.getByLabelText('Titlu'));
  await user.type(screen.getByLabelText('Titlu'), 'Titlu nou');
  expect(
    (
      await axe.run(container, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
  await user.click(
    screen.getByRole('button', { name: 'Salvează modificările' }),
  );
  expect(state.refetch).toHaveBeenCalledTimes(1);
  expect(state.mutate).toHaveBeenCalledWith({
    taskId: 1,
    title: 'Titlu nou',
    description: null,
    deadline: '2026-09-20T12:00:37Z',
    campaignId: 9,
  });
  expect(await screen.findByRole('status')).toHaveTextContent(
    'istoricul taskului',
  );
  expect(screen.getByRole('status')).toHaveFocus();
});
it('blocks a revoked Group or Campaign after refresh without losing input', async () => {
  state.refetch.mockResolvedValue({
    data: { ...data, groups: [] },
    isError: false,
  });
  render(<TaskEditControl task={task} canManage />);
  await userEvent.click(
    screen.getByRole('button', { name: 'Editează taskul' }),
  );
  await userEvent.clear(screen.getByLabelText('Titlu'));
  await userEvent.type(screen.getByLabelText('Titlu'), 'Nesalvat');
  await userEvent.click(
    screen.getByRole('button', { name: 'Salvează modificările' }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Nu mai ai permisiunea',
  );
  expect(state.mutate).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Titlu')).toHaveValue('Nesalvat');
});
it('prevents duplicate updates and retains confirmation when refetch completes the Task first', async () => {
  let resolve: (value: unknown) => void = () => {};
  state.mutate.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = render(<TaskEditControl task={task} canManage />);
  await userEvent.click(
    screen.getByRole('button', { name: 'Editează taskul' }),
  );
  await userEvent.dblClick(
    screen.getByRole('button', { name: 'Salvează modificările' }),
  );
  expect(state.mutate).toHaveBeenCalledTimes(1);
  view.rerender(
    <TaskEditControl task={{ ...task, status: 'completed' }} canManage />,
  );
  await act(async () => resolve({ id: 1 }));
  expect(screen.getByRole('status')).toHaveTextContent('salvate');
});
it('supports an Umbrella without deadline or Campaign', async () => {
  render(
    <TaskEditControl
      task={{ ...task, kind: 'umbrella', deadline: null, campaign_id: null }}
      canManage
    />,
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Editează taskul' }),
  );
  expect(screen.queryByLabelText('Campanie')).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole('button', { name: 'Salvează modificările' }),
  );
  expect(state.mutate).toHaveBeenCalledWith(
    expect.objectContaining({ deadline: null, campaignId: null }),
  );
});
