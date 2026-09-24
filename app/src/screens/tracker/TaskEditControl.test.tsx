import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import axe from 'axe-core';
import { taskRow } from '../../test/task-fixtures';
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
const state = vi.hoisted(() => ({
  options: vi.fn(),
  refetch: vi.fn(),
  mutate: vi.fn(),
  preview: vi.fn(),
}));
vi.mock('../../queries/task-form-options', () => ({
  useTaskFormOptions: state.options,
}));
vi.mock('../../queries/task-edit', async (original) => ({
  ...(await original<object>()),
  previewTaskUpdate: state.preview,
  useTaskEdit: () => ({ mutateAsync: state.mutate, isPending: false }),
}));
import { TaskEditControl } from './TaskEditControl';
import { TaskEditNeedsConfirmation } from '../../queries/task-edit';
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
  state.mutate.mockReset().mockResolvedValue({ id: 1 });
  state.preview.mockReset().mockResolvedValue([]);
});
async function openEditor(user = userEvent.setup()) {
  await user.click(screen.getByRole('button', { name: 'Editează taskul' }));
  return user;
}
it('hides editing for non-managers, in review and every terminal status', () => {
  const view = render(<TaskEditControl task={task} canManage={false} />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  for (const status of [
    'in_review',
    'completed',
    'unfulfilled',
    'cancelled',
  ] as const) {
    view.rerender(<TaskEditControl task={{ ...task, status }} canManage />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  }
});
it('stays editable while in progress, Feedback pending included', () => {
  render(
    <TaskEditControl
      task={{ ...task, status: 'in_progress', review_round: 1 }}
      canManage
    />,
  );
  expect(screen.getByRole('button', { name: 'Editează taskul' })).toBeVisible();
});
it('edits every field through update_task after a preview with no consequences', async () => {
  const { container } = render(<TaskEditControl task={task} canManage />);
  const user = await openEditor();
  expect(
    screen.queryByRole('option', { name: 'Alt grup' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Părinte' })).toBeInTheDocument();
  const campaign = screen.getByLabelText('Campanie (opțional)');
  expect(campaign).toHaveValue('9');
  expect(campaign).toHaveAccessibleDescription(/etichetă pentru raportare/i);
  expect(screen.queryByLabelText('Dificultate')).not.toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Salvează modificările' }),
  ).toBeDisabled();
  await user.clear(screen.getByLabelText('Titlu'));
  await user.type(screen.getByLabelText('Titlu'), 'Titlu nou');
  await user.selectOptions(screen.getByLabelText('Mod de atribuire'), 'public');
  await user.selectOptions(screen.getByLabelText('Audiență'), 'org');
  await user.selectOptions(campaign, '11');
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
  const values = {
    taskId: 1,
    groupId: 2,
    title: 'Titlu nou',
    description: null,
    deadline: '2026-09-20T12:00:37Z',
    campaignId: 11,
    assignmentMode: 'public',
    audience: 'org',
  };
  expect(state.refetch).toHaveBeenCalledTimes(1);
  expect(state.preview).toHaveBeenCalledWith(values);
  expect(state.mutate).toHaveBeenCalledWith({
    ...values,
    acceptConsequences: false,
  });
  expect(await screen.findByRole('status')).toHaveTextContent(
    'istoricul taskului',
  );
  expect(screen.getByRole('status')).toHaveFocus();
});
it('names every affected member and saves with their consequences accepted only after confirmation', async () => {
  state.preview.mockResolvedValue([
    { kind: 'candidate_removed', memberId: 'b', memberName: 'Bianca Pop' },
    { kind: 'candidate_removed', memberId: 'c', memberName: 'Cezar Ene' },
  ]);
  render(
    <TaskEditControl task={{ ...task, assignment_mode: 'public' }} canManage />,
  );
  const user = await openEditor();
  await user.selectOptions(screen.getByLabelText('Mod de atribuire'), 'direct');
  await user.click(
    screen.getByRole('button', { name: 'Salvează modificările' }),
  );
  const dialog = await screen.findByRole('dialog', {
    name: 'Confirmă modificarea',
  });
  expect(within(dialog).getByText(/Bianca Pop iese din lista/)).toBeVisible();
  expect(within(dialog).getByText(/Cezar Ene iese din lista/)).toBeVisible();
  expect(state.mutate).not.toHaveBeenCalled();

  await user.click(within(dialog).getByRole('button', { name: 'Renunță' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(state.mutate).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Mod de atribuire')).toHaveValue('direct');

  await user.click(
    screen.getByRole('button', { name: 'Salvează modificările' }),
  );
  await user.click(
    await screen.findByRole('button', { name: 'Confirmă și salvează' }),
  );
  expect(state.mutate).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      assignmentMode: 'direct',
      acceptConsequences: true,
    }),
  );
  expect(await screen.findByRole('status')).toHaveTextContent('salvate');
});
it('describes a removed Executor and promotes nobody (#682)', async () => {
  state.preview.mockResolvedValue([
    { kind: 'executor_removed', memberId: 'a', memberName: 'Ana Șerban' },
  ]);
  render(
    <TaskEditControl
      task={{ ...task, assignment_mode: 'public', audience: 'org' }}
      canManage
    />,
  );
  const user = await openEditor();
  await user.selectOptions(screen.getByLabelText('Audiență'), 'local');
  await user.click(
    screen.getByRole('button', { name: 'Salvează modificările' }),
  );
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent(
    'Ana Șerban nu mai este executor. Taskul revine la „De făcut”.',
  );
  expect(dialog).not.toHaveTextContent('devine executor');
});
it('explains Group appointment and Campaign clearing in confirmation', async () => {
  state.preview.mockResolvedValue([
    {
      kind: 'executor_added_to_group',
      memberId: 'a',
      memberName: 'Ana Șerban',
    },
    { kind: 'campaign_cleared', memberId: null, memberName: 'Un membru' },
  ]);
  render(<TaskEditControl task={task} canManage />);
  const user = await openEditor();
  await user.clear(screen.getByLabelText('Titlu'));
  await user.type(screen.getByLabelText('Titlu'), 'Titlu nou');
  await user.click(
    screen.getByRole('button', { name: 'Salvează modificările' }),
  );
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('Ana Șerban va fi adăugat în grupul nou.');
  expect(dialog).toHaveTextContent('Campania va fi eliminată');
  expect(dialog).toHaveTextContent('Salvarea are următoarele consecințe:');
});

it('shows the new consequences when the Task changed after the preview', async () => {
  state.mutate.mockRejectedValueOnce(
    new TaskEditNeedsConfirmation('confirmă din nou'),
  );
  state.preview
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      { kind: 'candidate_removed', memberId: 'b', memberName: 'Bianca Pop' },
    ]);
  render(
    <TaskEditControl task={{ ...task, assignment_mode: 'public' }} canManage />,
  );
  const user = await openEditor();
  await user.selectOptions(screen.getByLabelText('Mod de atribuire'), 'direct');
  await user.click(
    screen.getByRole('button', { name: 'Salvează modificările' }),
  );
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('Bianca Pop iese din lista de candidați');
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirmă și salvează' }),
  );
  expect(state.mutate).toHaveBeenLastCalledWith(
    expect.objectContaining({ acceptConsequences: true }),
  );
});
it('blocks a revoked Group after refresh without losing input', async () => {
  state.refetch.mockResolvedValue({
    data: { ...data, groups: [] },
    isError: false,
  });
  render(<TaskEditControl task={task} canManage />);
  const user = await openEditor();
  await user.clear(screen.getByLabelText('Titlu'));
  await user.type(screen.getByLabelText('Titlu'), 'Nesalvat');
  await user.click(
    screen.getByRole('button', { name: 'Salvează modificările' }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Nu mai ai permisiunea',
  );
  expect(state.preview).not.toHaveBeenCalled();
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
  const user = await openEditor();
  await user.type(screen.getByLabelText('Descriere'), 'Detalii');
  await user.dblClick(
    screen.getByRole('button', { name: 'Salvează modificările' }),
  );
  await waitFor(() => expect(state.mutate).toHaveBeenCalledTimes(1));
  view.rerender(
    <TaskEditControl task={{ ...task, status: 'completed' }} canManage />,
  );
  await act(async () => resolve({ id: 1 }));
  expect(screen.getByRole('status')).toHaveTextContent('salvate');
});
it('edits an Umbrella without deadline, Campaign, mode or audience', async () => {
  render(
    <TaskEditControl
      task={{
        ...task,
        kind: 'umbrella',
        deadline: null,
        campaign_id: null,
        assignment_mode: null,
        audience: null,
      }}
      canManage
    />,
  );
  const user = await openEditor();
  expect(screen.queryByLabelText(/Campanie/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Mod de atribuire')).not.toBeInTheDocument();
  await user.type(screen.getByLabelText('Descriere'), 'Plan');
  await user.click(
    screen.getByRole('button', { name: 'Salvează modificările' }),
  );
  await waitFor(() =>
    expect(state.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        deadline: null,
        campaignId: null,
        assignmentMode: null,
        audience: null,
      }),
    ),
  );
});
