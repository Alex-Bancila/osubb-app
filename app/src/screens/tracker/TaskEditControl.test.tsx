import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import axe from 'axe-core';
import { taskRow } from '../../test/task-fixtures';
import { findFormattedText } from '../../test/formatted-text';
import { chooseOption } from '../../test/select';
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
// R57: the editor's Level, which caps Cine îl vede (0 unless a case sets it).
const auth = vi.hoisted(() => ({ level: 0 }));
vi.mock('../../lib/auth', async (original) => ({
  ...(await original<object>()),
  useMemberLevel: () => auth.level,
}));
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
/** What a `Select` offers: its list is opened, read and closed again. */
async function optionNames(
  user: ReturnType<typeof userEvent.setup>,
  field: HTMLElement,
) {
  await user.click(field);
  const names = (await screen.findAllByRole('option')).map(
    (option) => option.textContent,
  );
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  return names;
}
const rootBox = () => screen.getByRole('combobox', { name: 'Grup principal' });
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
  links: [{ label: 'Brief', url: 'https://example.org/brief' }],
});
beforeEach(() => {
  state.options.mockReturnValue({ data, refetch: state.refetch });
  state.refetch.mockResolvedValue({ data, isError: false });
  state.mutate.mockReset().mockResolvedValue({ id: 1 });
  state.preview.mockReset().mockResolvedValue([]);
});
async function openEditor(user = userEvent.setup()) {
  await user.click(screen.getByRole('button', { name: 'Editează taskul' }));
  await screen.findByRole('dialog', { name: 'Editează taskul' });
  return user;
}
const modeGroup = () =>
  screen.getByRole('radiogroup', { name: 'Mod de atribuire' });
const audienceGroup = () =>
  screen.getByRole('radiogroup', { name: 'Audiență' });
const segment = (group: HTMLElement, name: string) =>
  within(group).getByRole('radio', { name });
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
it('is the sheet’s primary action: a filled button with a pencil, named "Editează taskul"', () => {
  render(<TaskEditControl task={task} canManage />);
  const edit = screen.getByRole('button', { name: 'Editează taskul' });
  expect(edit.querySelector('svg.lucide-pencil')).not.toBeNull();
  // Filled, not outlined; "taskul" is kept for a screen reader only.
  expect(edit).toHaveClass('bg-primary');
  expect(within(edit).getByText('taskul')).toHaveClass('sr-only');
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
  render(<TaskEditControl task={task} canManage />);
  const user = await openEditor();
  // The form is a form sheet over the details: no box inside them, the
  // actions pinned with Renunță first.
  const sheet = screen.getByRole('dialog', { name: 'Editează taskul' });
  expect(sheet).toHaveAttribute('data-slot', 'form-sheet');
  const footer = sheet.querySelector<HTMLElement>(
    '[data-slot="sheet-footer"][data-pinned]',
  );
  expect(
    within(footer as HTMLElement)
      .getAllByRole('button')
      .map((button) => button.textContent),
  ).toEqual(['Renunță', 'Salvează modificările']);
  expect(screen.getByLabelText('Termen — ora României')).toHaveAttribute(
    'data-slot',
    'date-picker',
  );
  const campaign = screen.getByLabelText('Campanie (opțional)');
  // The Task's own Campaign, no longer offered, stays in the list as the
  // current one; another Group's Campaign is not there.
  expect(campaign).toHaveAttribute('data-value', '9');
  expect(campaign).toHaveTextContent('Istoric (actuală)');
  expect(await optionNames(user, campaign)).toEqual([
    'Fără campanie',
    'Istoric (actuală)',
    'Părinte',
    'Copil',
  ]);
  expect(campaign).toHaveAccessibleDescription(/etichetă pentru raportare/i);
  expect(screen.queryByLabelText('Dificultate')).not.toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Salvează modificările' }),
  ).toBeDisabled();
  await user.clear(screen.getByLabelText('Titlu'));
  await user.type(screen.getByLabelText('Titlu'), 'Titlu nou');
  await user.click(segment(modeGroup(), 'Public'));
  await user.click(segment(audienceGroup(), 'Toți membrii OSUBB'));
  await chooseOption(user, campaign, 'Copil');
  expect(
    (
      await axe.run(sheet, {
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
    // Full state: the prefilled links travel as the form shows them.
    links: [{ label: 'Brief', url: 'https://example.org/brief' }],
    // R57: a public Task sends its Cine îl vede (Recrut by default).
    minLevel: 0,
    // #1132: the version the form was seeded from.
    updatedAt: '2026-09-18T07:00:00.123456+00:00',
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
}, 20_000);
it('returns focus to "Editează" when the sheet is cancelled, and reopens from the Task as it is', async () => {
  render(<TaskEditControl task={task} canManage />);
  const user = await openEditor();
  await user.type(screen.getByLabelText('Titlu'), ' schimbat');
  await user.click(screen.getByRole('button', { name: 'Renunță' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('button', { name: 'Editează taskul' })).toHaveFocus();
  expect(state.mutate).not.toHaveBeenCalled();
  await openEditor(user);
  expect(screen.getByLabelText('Titlu')).toHaveValue(task.title);
});
it('hides Audiență while Direct and opens it from the stored Audience on switching to Public (R26)', async () => {
  render(<TaskEditControl task={task} canManage />);
  const user = await openEditor();
  expect(modeGroup()).toHaveAttribute('data-slot', 'segmented-radio');
  expect(segment(modeGroup(), 'Direct')).toBeChecked();
  expect(screen.queryByRole('radiogroup', { name: 'Audiență' })).toBeNull();

  // The convert-to-public path starts from the Task's stored Audience.
  await user.click(segment(modeGroup(), 'Public'));
  expect(segment(audienceGroup(), 'Membrii grupului')).toBeChecked();
  expect(audienceGroup()).toHaveAccessibleDescription(
    'Cine vede taskul și se poate înscrie.',
  );
  expect(
    within(audienceGroup())
      .getAllByRole('radio')
      .map((option) => option.textContent),
  ).toEqual(['Membrii grupului', 'Toți membrii OSUBB']);
  await user.click(segment(audienceGroup(), 'Toți membrii OSUBB'));
  await user.click(segment(modeGroup(), 'Direct'));
  expect(screen.queryByRole('radiogroup', { name: 'Audiență' })).toBeNull();
  await user.click(segment(modeGroup(), 'Public'));
  expect(segment(audienceGroup(), 'Toți membrii OSUBB')).toBeChecked();
});
it('sends local when a public org Task goes Direct (R26)', async () => {
  render(
    <TaskEditControl
      task={{ ...task, assignment_mode: 'public', audience: 'org' }}
      canManage
    />,
  );
  const user = await openEditor();
  await user.click(segment(modeGroup(), 'Direct'));
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
  const mode = modeGroup();
  await waitFor(() =>
    expect(mode).toHaveAccessibleDescription(
      expect.stringContaining(
        'Un task atribuit direct este doar pentru grupul lui. Alege modul public ca să-l deschizi întregului OSUBB.',
      ),
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
  await user.click(segment(modeGroup(), 'Direct'));
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
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'Confirmă modificarea' }),
    ).toBeNull(),
  );
  expect(state.mutate).not.toHaveBeenCalled();
  expect(segment(modeGroup(), 'Direct')).toBeChecked();

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
  await user.click(segment(audienceGroup(), 'Membrii grupului'));
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
  expect(screen.getByLabelText('Campanie (opțional)')).toHaveAttribute(
    'data-value',
    '9',
  );
  expect(
    await optionNames(user, screen.getByLabelText('Campanie (opțional)')),
  ).toEqual(['Fără campanie', 'Istoric (actuală)', 'Vară']);
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
  await chooseOption(
    user,
    screen.getByLabelText('Campanie (opțional)'),
    'Copil',
  );
  await pick(
    user,
    screen.getByRole('combobox', { name: 'Subgrup (opțional)' }),
    /^Afișe/,
  );
  // Copil (owned by Echipa) still tags Afișe, below it.
  expect(screen.getByLabelText('Campanie (opțional)')).toHaveAttribute(
    'data-value',
    '11',
  );
  await pick(user, rootBox(), 'Tineret');
  expect(screen.getByLabelText('Campanie (opțional)')).toHaveAttribute(
    'data-value',
    '',
  );
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

it('edits the Attached Links as full state: prefilled, checked per row, added and removed (R46)', async () => {
  render(<TaskEditControl task={task} canManage />);
  const user = await openEditor();
  const label = screen.getByLabelText('Etichetă link 1');
  const url = screen.getByLabelText('Adresă link 1');
  expect(label).toHaveValue('Brief');
  expect(url).toHaveValue('https://example.org/brief');
  await user.clear(url);
  await user.click(
    screen.getByRole('button', { name: 'Salvează modificările' }),
  );
  expect(url).toHaveAccessibleDescription(
    /Scrie adresa linkului sau lasă linkul gol./,
  );
  expect(state.preview).not.toHaveBeenCalled();
  await user.type(url, 'https://example.org/nou');
  await user.click(screen.getByRole('button', { name: 'Adaugă link' }));
  await user.type(screen.getByLabelText('Etichetă link 2'), 'Afiș');
  await user.type(
    screen.getByLabelText('Adresă link 2'),
    'https://example.org/afis',
  );
  await user.click(
    screen.getByRole('button', { name: 'Salvează modificările' }),
  );
  await waitFor(() =>
    expect(state.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        links: [
          { label: 'Brief', url: 'https://example.org/nou' },
          { label: 'Afiș', url: 'https://example.org/afis' },
        ],
      }),
    ),
  );
  // Much typing: slow under the full parallel run.
}, 20_000);

it('clears every Attached Link by removing the rows (R46)', async () => {
  render(<TaskEditControl task={task} canManage />);
  const user = await openEditor();
  await user.click(screen.getByRole('button', { name: 'Elimină linkul 1' }));
  expect(screen.queryByLabelText('Etichetă link 1')).toBeNull();
  await user.click(
    screen.getByRole('button', { name: 'Salvează modificările' }),
  );
  await waitFor(() =>
    expect(state.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ links: [] }),
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
  await user.click(segment(modeGroup(), 'Direct'));
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
  await user.type(await findFormattedText('Descriere (opțional)'), 'Detalii');
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
it('opens Salvează on the first key typed in the Descriere, with no wait (R60, ruling 35)', async () => {
  render(<TaskEditControl task={task} canManage />);
  const user = await openEditor();
  const save = screen.getByRole('button', { name: 'Salvează modificările' });
  expect(save).toBeDisabled();

  await user.type(await findFormattedText('Descriere (opțional)'), 'P');

  expect(save).toBeEnabled();
});
it('closes Salvează again when a Descriere typed in is put back (R60, ruling 36)', async () => {
  // A description written before R60: the editor writes its three line
  // breaks as two.
  render(
    <TaskEditControl
      task={{ ...task, description: 'Salut!\n\n\nȘedința' }}
      canManage
    />,
  );
  const user = await openEditor();
  const save = screen.getByRole('button', { name: 'Salvează modificările' });

  await user.type(await findFormattedText('Descriere (opțional)'), 'x');
  expect(save).toBeEnabled();
  await user.keyboard('{Backspace}');
  await user.click(screen.getByLabelText('Titlu'));

  expect(save).toBeDisabled();
});
it('saves a Descriere it never changed exactly as stored (R60, Review Focus 1)', async () => {
  // Markers the editor would write escaped: `* ` opens a list in the dialect
  // and `5*3*2` holds two asterisks.
  const legacy = '* unu\n5*3*2';
  render(<TaskEditControl task={{ ...task, description: legacy }} canManage />);
  const user = await openEditor();
  // The editor itself holds the text, not the read-only text area it shows
  // while its chunk loads.
  await findFormattedText('Descriere (opțional)');

  await user.type(screen.getByLabelText('Titlu'), ' nou');
  await user.click(
    screen.getByRole('button', { name: 'Salvează modificările' }),
  );

  await waitFor(() =>
    expect(state.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: `${task.title} nou`,
        description: legacy,
      }),
    ),
  );
});
it('puts a server refusal of the Descriere under it (R60)', async () => {
  state.mutate.mockRejectedValueOnce({
    code: 'PT400',
    message: 'description_too_long',
  });
  render(<TaskEditControl task={task} canManage />);
  const user = await openEditor();
  const description = await findFormattedText('Descriere (opțional)');
  await user.type(description, 'Plan');
  await user.click(
    screen.getByRole('button', { name: 'Salvează modificările' }),
  );

  await waitFor(() =>
    expect(description).toHaveAccessibleDescription(
      /Descrierea are cel mult 2000 de caractere/,
    ),
  );
  expect(description).toHaveAttribute('aria-invalid', 'true');
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
  await user.type(await findFormattedText('Descriere (opțional)'), 'Plan');
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

it('prefills Cine îl vede from the Task and sends a new Role (R57)', async () => {
  auth.level = 6;
  state.options.mockReturnValue({
    data,
    isPending: false,
    isError: false,
    refetch: state.refetch.mockResolvedValue({ data }),
  });
  state.preview.mockResolvedValue([]);
  state.mutate.mockResolvedValue({});
  render(
    <TaskEditControl
      task={taskRow({
        ...task,
        assignment_mode: 'public',
        audience: 'org',
        min_level: 1,
      })}
      canManage
    />,
  );
  const user = await openEditor();
  const field = screen.getByLabelText('Cine îl vede');
  expect(field).toHaveTextContent('Voluntar');
  await chooseOption(user, field, 'BC');
  await user.click(
    screen.getByRole('button', { name: 'Salvează modificările' }),
  );
  await waitFor(() =>
    expect(state.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ minLevel: 6, acceptConsequences: false }),
    ),
  );
  auth.level = 0;
});
it('shows a Role above the editor without offering it, and keeps it (R57)', async () => {
  auth.level = 1;
  state.options.mockReturnValue({
    data,
    isPending: false,
    isError: false,
    refetch: state.refetch.mockResolvedValue({ data }),
  });
  render(
    <TaskEditControl
      task={taskRow({
        ...task,
        assignment_mode: 'public',
        audience: 'org',
        min_level: 6,
      })}
      canManage
    />,
  );
  await openEditor();
  expect(screen.queryByLabelText('Cine îl vede')).toBeNull();
  expect(
    screen.getByText('De la BC. Doar cineva cu acest rol îl poate schimba.'),
  ).toBeVisible();
  auth.level = 0;
});
it('neither shows nor sends Cine îl vede for a row that does not carry it (R57)', async () => {
  auth.level = 6;
  state.options.mockReturnValue({
    data,
    isPending: false,
    isError: false,
    refetch: state.refetch.mockResolvedValue({ data }),
  });
  state.preview.mockResolvedValue([]);
  state.mutate.mockResolvedValue({});
  const { min_level: _dropped, ...withoutRole } = taskRow({
    ...task,
    assignment_mode: 'public',
    audience: 'org',
  });
  render(<TaskEditControl task={withoutRole as typeof task} canManage />);
  const user = await openEditor();
  expect(screen.queryByLabelText('Cine îl vede')).toBeNull();
  await user.type(screen.getByLabelText('Titlu'), ' nou');
  await user.click(
    screen.getByRole('button', { name: 'Salvează modificările' }),
  );
  await waitFor(() =>
    expect(state.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ minLevel: null }),
    ),
  );
  auth.level = 0;
});
it('invents no Role change on a local Task stored below its Group’s floor (R57, review)', async () => {
  auth.level = 6;
  state.options.mockReturnValue({
    data,
    isPending: false,
    isError: false,
    refetch: state.refetch.mockResolvedValue({ data }),
  });
  state.preview.mockResolvedValue([]);
  state.mutate.mockResolvedValue({});
  // Echipa (2) sits at Voluntar; the Task was stored at 0 (every Task before R57).
  render(
    <TaskEditControl
      task={taskRow({
        ...task,
        assignment_mode: 'public',
        audience: 'local',
        min_level: 0,
      })}
      canManage
    />,
  );
  const user = await openEditor();
  expect(
    screen.getByRole('button', { name: 'Salvează modificările' }),
  ).toBeDisabled();
  await user.type(screen.getByLabelText('Titlu'), ' nou');
  await user.click(
    screen.getByRole('button', { name: 'Salvează modificările' }),
  );
  await waitFor(() =>
    expect(state.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ minLevel: 0 }),
    ),
  );
  auth.level = 0;
});
it('disables Direct under a Role above the editor, and says why (R57)', async () => {
  auth.level = 1;
  state.options.mockReturnValue({
    data,
    isPending: false,
    isError: false,
    refetch: state.refetch.mockResolvedValue({ data }),
  });
  render(
    <TaskEditControl
      task={taskRow({
        ...task,
        assignment_mode: 'public',
        audience: 'org',
        min_level: 6,
      })}
      canManage
    />,
  );
  await openEditor();
  expect(segment(modeGroup(), 'Direct')).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  expect(modeGroup()).toHaveAccessibleDescription(
    /Doar cineva de la BC în sus poate face taskul direct/,
  );
  auth.level = 0;
});

// #1132 (audit M12): the form is seeded once. A live change of the Task
// under the open sheet neither flips "changed" nor leaks into what is sent:
// the save carries the seed's deadline and the seed's version.
it('keeps its seed when the Task changes under the open form, and sends that seed’s version', async () => {
  const view = render(<TaskEditControl task={task} canManage />);
  const user = await openEditor();
  const save = screen.getByRole('button', { name: 'Salvează modificările' });
  expect(save).toBeDisabled();
  view.rerender(
    <TaskEditControl
      task={{
        ...task,
        title: 'Titlu de la B',
        deadline: '2026-09-21T12:00:00Z',
        updated_at: '2026-09-18T08:00:00+00:00',
      }}
      canManage
    />,
  );
  expect(save).toBeDisabled();
  expect(screen.getByLabelText('Titlu')).toHaveValue(task.title);
  await user.clear(screen.getByLabelText('Titlu'));
  await user.type(screen.getByLabelText('Titlu'), 'Titlu corectat');
  await user.click(save);
  await waitFor(() => expect(state.mutate).toHaveBeenCalledTimes(1));
  expect(state.mutate).toHaveBeenCalledWith(
    expect.objectContaining({
      title: 'Titlu corectat',
      deadline: task.deadline,
      updatedAt: task.updated_at,
    }),
  );
});
it('says the Task changed on a stale save and re-seeds the form from the live row on request', async () => {
  state.mutate.mockRejectedValueOnce(
    new TaskEditError({ code: 'PT409', message: 'task_changed' }, 'x'),
  );
  const view = render(<TaskEditControl task={task} canManage />);
  const user = await openEditor();
  await user.clear(screen.getByLabelText('Titlu'));
  await user.type(screen.getByLabelText('Titlu'), 'Titlu corectat');
  await user.click(
    screen.getByRole('button', { name: 'Salvează modificările' }),
  );
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Taskul a fost modificat între timp');
  view.rerender(
    <TaskEditControl
      task={{
        ...task,
        title: 'Titlu de la B',
        updated_at: '2026-09-18T08:00:00+00:00',
      }}
      canManage
    />,
  );
  await user.click(
    within(alert).getByRole('button', { name: 'Reîncarcă formularul' }),
  );
  expect(await screen.findByDisplayValue('Titlu de la B')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Salvează modificările' }),
  ).toBeDisabled();
});
