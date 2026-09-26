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
import {
  TaskEditError,
  TaskEditNeedsConfirmation,
} from '../../queries/task-edit';
const data = {
  groups: [{ id: 2, name: 'Echipa', path: [1, 2], min_level: 1 }],
  campaigns: [
    { id: 10, name: 'Părinte', group_id: 1 },
    { id: 11, name: 'Copil', group_id: 2 },
    { id: 12, name: 'Alt grup', group_id: 3 },
  ],
  umbrellas: [],
};
// The caller manages Echipa (2) with its Team Afișe (5) and all of Tineret (4).
const moving = {
  ...data,
  groups: [
    { id: 2, name: 'Echipa', path: [1, 2], min_level: 1 },
    { id: 5, name: 'Afișe', path: [1, 2, 5], min_level: 1 },
    { id: 4, name: 'Tineret', path: [4], min_level: 0 },
  ],
  campaigns: [...data.campaigns, { id: 13, name: 'Vară', group_id: 4 }],
};
const rootBox = () =>
  screen.getByRole('combobox', { name: 'Grup principal (obligatoriu)' });
async function pick(
  user: ReturnType<typeof userEvent.setup>,
  box: HTMLElement,
  name: RegExp | string,
) {
  await user.click(box);
  await user.click(await screen.findByRole('option', { name }));
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
}
const task = taskRow({
  group_id: 2,
  deadline: '2026-09-20T12:00:37Z',
  campaign_id: 9,
  campaign: { name: 'Istoric' },
  link_label: 'Brief',
  link_url: 'https://example.org/brief',
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
    // Full state: the prefilled link travels as the form shows it.
    linkLabel: 'Brief',
    linkUrl: 'https://example.org/brief',
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
it('hides Audiență while Direct and opens it from the stored Audience on switching to Public (R26)', async () => {
  render(<TaskEditControl task={task} canManage />);
  const user = await openEditor();
  const mode = screen.getByLabelText('Mod de atribuire');
  expect(mode).toHaveValue('direct');
  expect(screen.queryByLabelText('Audiență')).not.toBeInTheDocument();

  // The convert-to-public path starts from the Task's stored Audience.
  await user.selectOptions(mode, 'public');
  const audience = screen.getByLabelText('Audiență');
  expect(audience).toHaveValue('local');
  expect(audience).toHaveAccessibleDescription(
    'Cine vede taskul și se poate înscrie.',
  );
  expect(
    within(audience)
      .getAllByRole('option')
      .map((option) => option.textContent),
  ).toEqual(['Membrii grupului', 'Toți membrii OSUBB']);
  await user.selectOptions(audience, 'org');
  await user.selectOptions(mode, 'direct');
  expect(screen.queryByLabelText('Audiență')).not.toBeInTheDocument();
  await user.selectOptions(mode, 'public');
  expect(screen.getByLabelText('Audiență')).toHaveValue('org');
});
it('sends local when a public org Task goes Direct (R26)', async () => {
  render(
    <TaskEditControl
      task={{ ...task, assignment_mode: 'public', audience: 'org' }}
      canManage
    />,
  );
  const user = await openEditor();
  await user.selectOptions(screen.getByLabelText('Mod de atribuire'), 'direct');
  await user.click(
    screen.getByRole('button', { name: 'Salvează modificările' }),
  );
  await waitFor(() =>
    expect(state.preview).toHaveBeenCalledWith(
      expect.objectContaining({ assignmentMode: 'direct', audience: 'local' }),
    ),
  );
});
it('puts a direct_task_local_only refusal on Mod de atribuire (R26)', async () => {
  state.preview.mockRejectedValue(
    new TaskEditError({ message: 'direct_task_local_only' }, 'fallback'),
  );
  render(<TaskEditControl task={task} canManage />);
  const user = await openEditor();
  await user.type(screen.getByLabelText('Titlu'), ' nou');
  await user.click(
    screen.getByRole('button', { name: 'Salvează modificările' }),
  );
  const mode = screen.getByLabelText('Mod de atribuire');
  await waitFor(() =>
    expect(mode).toHaveAccessibleDescription(
      'Un task atribuit direct este doar pentru grupul lui. Alege modul public ca să-l deschizi întregului OSUBB.',
    ),
  );
  expect(state.mutate).not.toHaveBeenCalled();
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
it('moves the Task to another Group only after listing every consequence by name (#627)', async () => {
  state.options.mockReturnValue({ data: moving, refetch: state.refetch });
  state.refetch.mockResolvedValue({ data: moving, isError: false });
  state.preview.mockResolvedValue([
    {
      kind: 'executor_added_to_group',
      memberId: 'a',
      memberName: 'Ana Șerban',
    },
    { kind: 'executor_removed', memberId: 'e', memberName: 'Emil Pop' },
    { kind: 'candidate_removed', memberId: 'b', memberName: 'Bianca Pop' },
    { kind: 'campaign_cleared', memberId: null, memberName: 'Un membru' },
    { kind: 'queue_reshuffled', memberId: 'c', memberName: 'Cezar Ene' },
    { kind: 'something_new', memberId: null, memberName: 'Un membru' },
  ]);
  render(<TaskEditControl task={task} canManage />);
  const user = await openEditor();
  // Prefilled with the Task's Group: Echipa is the root, nothing below chosen.
  expect(rootBox()).toHaveTextContent('Echipa');
  expect(
    screen.getByRole('combobox', { name: 'Subgrup (opțional)' }),
  ).toHaveTextContent('Doar grupul principal');
  await pick(user, rootBox(), 'Tineret');
  expect(
    screen.queryByRole('combobox', { name: 'Subgrup (opțional)' }),
  ).not.toBeInTheDocument();
  // The Task's own Campaign stays chosen; the server says if it must go.
  expect(screen.getByLabelText('Campanie (opțional)')).toHaveValue('9');
  expect(screen.getByRole('option', { name: 'Vară' })).toBeInTheDocument();
  expect(
    screen.queryByRole('option', { name: 'Copil' }),
  ).not.toBeInTheDocument();
  await user.click(
    screen.getByRole('button', { name: 'Salvează modificările' }),
  );
  expect(state.preview).toHaveBeenCalledWith(
    expect.objectContaining({ groupId: 4, campaignId: 9 }),
  );
  const dialog = await screen.findByRole('dialog', {
    name: 'Confirmă modificarea',
  });
  const lines = within(dialog)
    .getAllByRole('listitem')
    .map((item) => item.textContent);
  expect(lines).toEqual([
    'Ana Șerban devine membru al grupului nou.',
    'Emil Pop nu mai este executor. Taskul revine la „De făcut”.',
    'Bianca Pop iese din lista de candidați.',
    'Campania se șterge: nu poate eticheta taskuri în grupul nou.',
    // Kinds this screen does not know are still listed, never skipped.
    'Participarea lui Cezar Ene la task se schimbă.',
    expect.stringMatching(/nu o poate descrie/),
  ]);
  expect(lines.join(' ')).not.toMatch(/_/);
  expect(
    (
      await axe.run(dialog, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
  expect(state.mutate).not.toHaveBeenCalled();
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirmă și salvează' }),
  );
  expect(state.mutate).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ groupId: 4, acceptConsequences: true }),
  );
  expect(await screen.findByRole('status')).toHaveTextContent('salvate');
});

it('moves to a Group below, clearing a Campaign picked here that cannot follow', async () => {
  state.options.mockReturnValue({ data: moving, refetch: state.refetch });
  state.refetch.mockResolvedValue({ data: moving, isError: false });
  render(
    <TaskEditControl
      task={{ ...task, campaign_id: null, campaign: null }}
      canManage
    />,
  );
  const user = await openEditor();
  await user.selectOptions(screen.getByLabelText('Campanie (opțional)'), '11');
  await pick(
    user,
    screen.getByRole('combobox', { name: 'Subgrup (opțional)' }),
    /^Afișe/,
  );
  // Copil (owned by Echipa) still tags Afișe, below it.
  expect(screen.getByLabelText('Campanie (opțional)')).toHaveValue('11');
  await pick(user, rootBox(), 'Tineret');
  expect(screen.getByLabelText('Campanie (opțional)')).toHaveValue('');
  await user.click(
    screen.getByRole('button', { name: 'Salvează modificările' }),
  );
  await waitFor(() =>
    expect(state.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: 4, campaignId: null }),
    ),
  );
});

it('locks the Group of a Subtask and of an Umbrella with Subtasks', async () => {
  state.options.mockReturnValue({ data: moving, refetch: state.refetch });
  const view = render(
    <TaskEditControl task={{ ...task, parent_task_id: 30 }} canManage />,
  );
  await openEditor();
  expect(rootBox()).toBeDisabled();
  expect(rootBox()).toHaveAccessibleDescription(
    'Un subtask rămâne în grupul taskului-umbrelă.',
  );
  view.unmount();
  render(
    <TaskEditControl
      task={{
        ...task,
        kind: 'umbrella',
        campaign_id: null,
        assignment_mode: null,
        audience: null,
        subtasks: [{ id: 31, status: 'todo' }],
      }}
      canManage
    />,
  );
  await openEditor();
  expect(rootBox()).toBeDisabled();
  expect(rootBox()).toHaveAccessibleDescription(
    'Un task-umbrelă cu subtaskuri nu își poate schimba grupul.',
  );
});

it('puts the server’s refusal of a move under the Group field', async () => {
  state.options.mockReturnValue({ data: moving, refetch: state.refetch });
  state.refetch.mockResolvedValue({ data: moving, isError: false });
  state.preview.mockRejectedValue(
    new TaskEditError({ message: 'umbrella_has_subtasks' }, 'fallback'),
  );
  render(
    <TaskEditControl
      task={{
        ...task,
        kind: 'umbrella',
        campaign_id: null,
        assignment_mode: null,
        audience: null,
      }}
      canManage
    />,
  );
  const user = await openEditor();
  await pick(user, rootBox(), 'Tineret');
  await user.click(
    screen.getByRole('button', { name: 'Salvează modificările' }),
  );
  await waitFor(() =>
    expect(rootBox()).toHaveAccessibleDescription(
      'Un task-umbrelă cu subtaskuri nu își poate schimba grupul.',
    ),
  );
  expect(state.mutate).not.toHaveBeenCalled();
});

it('refuses a Group a fresh read no longer offers, under the Group field', async () => {
  state.options.mockReturnValue({ data: moving, refetch: state.refetch });
  state.refetch.mockResolvedValue({
    data: { ...moving, groups: moving.groups.filter((row) => row.id !== 4) },
    isError: false,
  });
  render(<TaskEditControl task={task} canManage />);
  const user = await openEditor();
  await pick(user, rootBox(), 'Tineret');
  await user.click(
    screen.getByRole('button', { name: 'Salvează modificările' }),
  );
  await waitFor(() =>
    expect(rootBox()).toHaveAccessibleDescription(
      /Nu mai poți pregăti taskuri pentru grupul ales/,
    ),
  );
  expect(rootBox()).toHaveAttribute('aria-invalid', 'true');
  expect(state.preview).not.toHaveBeenCalled();
});

it('edits the Attached Link as full state: prefilled, checked as a pair, cleared with blanks', async () => {
  render(<TaskEditControl task={task} canManage />);
  const user = await openEditor();
  const label = screen.getByLabelText('Etichetă link');
  const url = screen.getByLabelText('Adresă link');
  expect(label).toHaveValue('Brief');
  expect(url).toHaveValue('https://example.org/brief');
  await user.clear(url);
  await user.click(
    screen.getByRole('button', { name: 'Salvează modificările' }),
  );
  expect(url).toHaveAccessibleDescription(
    'Scrie adresa linkului sau lasă linkul gol.',
  );
  expect(state.preview).not.toHaveBeenCalled();
  await user.clear(label);
  await user.click(
    screen.getByRole('button', { name: 'Salvează modificările' }),
  );
  await waitFor(() =>
    expect(state.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ linkLabel: null, linkUrl: null }),
    ),
  );
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
