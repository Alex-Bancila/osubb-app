vi.mock('../../lib/supabase', () => ({ supabase: {} }));
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { expect, it, vi } from 'vitest';
import { TaskForm } from './TaskForm';
import type { TaskFormOptions } from './task-form-model';
vi.mock('../../queries/direct-executors', async (original) => ({
  ...(await original<typeof import('../../queries/direct-executors')>()),
  useDirectExecutors: () => ({
    isSuccess: true,
    data: {
      members: [{ id: 'ana', name: 'Ana Pop', level: 3, avatarColor: null }],
      groups: [
        {
          id: 3,
          name: 'Echipa afișe',
          path: [1, 2, 3],
          min_level: 1,
          automatic_membership: false,
          status: 'active',
        },
        {
          id: 4,
          name: 'Tineret',
          path: [4],
          min_level: 0,
          automatic_membership: false,
          status: 'active',
        },
      ],
      memberships: [],
    },
  }),
}));
const options: TaskFormOptions = {
  groups: [
    { id: 2, name: 'Conferință', path: [1, 2], min_level: 1 },
    { id: 3, name: 'Echipa afișe', path: [1, 2, 3], min_level: 1 },
    { id: 4, name: 'Tineret', path: [4], min_level: 0 },
  ],
  campaigns: [
    { id: 10, name: 'Campanie părinte', group_id: 1 },
    { id: 11, name: 'Campanie proprie', group_id: 3 },
    { id: 12, name: 'Altă origine', group_id: 4 },
  ],
  umbrellas: [
    { id: 30, title: 'Pregătește conferința', group_id: 3 },
    { id: 31, title: 'Tabăra de vară', group_id: 4 },
  ],
  // Educațional is readable but not managed: it still names its child.
  groupNames: [{ id: 1, name: 'Educațional' }],
};
type User = ReturnType<typeof userEvent.setup>;
const groupBox = () =>
  screen.getByRole('combobox', { name: 'Grup de origine (obligatoriu)' });
const parentBox = () =>
  screen.getByRole('combobox', { name: 'Task-umbrelă (obligatoriu)' });
const optionTexts = () =>
  within(screen.getByRole('listbox'))
    .getAllByRole('option')
    .map((option) => option.textContent);
async function pick(user: User, box: HTMLElement, name: RegExp | string) {
  await user.click(box);
  await user.click(await screen.findByRole('option', { name }));
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
}
async function content() {
  const user = userEvent.setup();
  await user.type(
    screen.getByLabelText('Titlu (obligatoriu)'),
    '  Pregătește afișele  ',
  );
  fireEvent.change(screen.getByLabelText(/Termen/), {
    target: { value: '2026-10-01T12:30' },
  });
  return user;
}
it('picks the Origin from a searchable Group list showing each parent, and emits a trimmed direct draft', async () => {
  const onDraft = vi.fn();
  const { container } = render(
    <TaskForm options={options} onDraft={onDraft} />,
  );
  const user = await content();
  await user.click(groupBox());
  await screen.findByRole('listbox');
  expect(optionTexts()).toEqual([
    'Conferință· Educațional',
    'Echipa afișe· Conferință',
    'Tineret',
  ]);
  await user.type(
    await screen.findByRole('combobox', { name: 'Caută un grup' }),
    'conf',
  );
  await waitFor(() =>
    expect(optionTexts()).toEqual([
      'Conferință· Educațional',
      'Echipa afișe· Conferință',
    ]),
  );
  await user.click(screen.getByRole('option', { name: /^Echipa afișe/ }));
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  expect(groupBox()).toHaveTextContent('Echipa afișe');
  const campaign = screen.getByLabelText('Campanie (opțional)');
  expect(campaign).toHaveAccessibleDescription(/etichetă pentru raportare/i);
  expect(
    screen.getByRole('option', { name: 'Campanie părinte' }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('option', { name: 'Altă origine' }),
  ).not.toBeInTheDocument();
  await user.selectOptions(campaign, '10');
  await pick(
    user,
    screen.getByRole('combobox', { name: 'Executor' }),
    'Ana Pop',
  );
  expect(screen.queryByLabelText(/Dificultate/)).not.toBeInTheDocument();
  expect((await axe.run(container)).violations).toEqual([]);
  await user.click(screen.getByRole('button', { name: 'Continuă' }));
  expect(onDraft).toHaveBeenCalledWith({
    title: 'Pregătește afișele',
    description: null,
    deadline: '2026-10-01T09:30:00.000Z',
    groupId: 3,
    kind: 'task',
    parentTaskId: null,
    audience: 'local',
    assignmentMode: 'direct',
    executorId: 'ana',
    campaignId: 10,
  });
});
it('clears the Executor on public mode and clears incompatible Campaigns after Origin changes', async () => {
  const onDraft = vi.fn();
  render(<TaskForm options={options} onDraft={onDraft} />);
  const user = await content();
  await pick(user, groupBox(), /^Echipa afișe/);
  await user.selectOptions(screen.getByLabelText('Campanie (opțional)'), '10');
  await pick(
    user,
    screen.getByRole('combobox', { name: 'Executor' }),
    'Ana Pop',
  );
  await user.selectOptions(screen.getByLabelText('Mod de atribuire'), 'public');
  expect(
    screen.queryByRole('combobox', { name: 'Executor' }),
  ).not.toBeInTheDocument();
  await pick(user, groupBox(), 'Tineret');
  expect(screen.getByLabelText('Campanie (opțional)')).toHaveValue('');
  await user.click(screen.getByRole('button', { name: 'Continuă' }));
  expect(onDraft).toHaveBeenCalledWith(
    expect.objectContaining({
      groupId: 4,
      assignmentMode: 'public',
      executorId: null,
      campaignId: null,
    }),
  );
});
it('tells a Task-umbrelă (a parent of Subtasks) apart from a Campaign (a reporting label)', async () => {
  render(<TaskForm options={options} onDraft={vi.fn()} />);
  const user = userEvent.setup();
  const kind = screen.getByRole('radiogroup', { name: 'Ce fel de task?' });
  expect(kind).toBeInTheDocument();
  expect(
    screen.getByRole('radio', { name: 'Task-umbrelă' }),
  ).toHaveAccessibleDescription(/task părinte care grupează subtaskuri/i);
  expect(
    screen.getByRole('radio', { name: 'Subtask' }),
  ).toHaveAccessibleDescription(/parte dintr-un task-umbrelă/i);
  await user.click(screen.getByRole('radio', { name: 'Task-umbrelă' }));
  expect(
    screen.queryByLabelText('Campanie (opțional)'),
  ).not.toBeInTheDocument();
});
it('offers only the chosen Group’s Umbrellas as Subtask parents, and a parent sets the Group', async () => {
  const onDraft = vi.fn();
  render(<TaskForm options={options} onDraft={onDraft} />);
  const user = await content();
  await user.click(screen.getByRole('radio', { name: 'Subtask' }));
  await user.click(parentBox());
  await screen.findByRole('listbox');
  expect(optionTexts()).toEqual([
    'Pregătește conferința· Echipa afișe',
    'Tabăra de vară· Tineret',
  ]);
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());

  await pick(user, groupBox(), 'Tineret');
  await user.click(parentBox());
  await screen.findByRole('listbox');
  expect(optionTexts()).toEqual(['Tabăra de vară']);
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());

  await pick(user, groupBox(), /^Echipa afișe/);
  await pick(user, parentBox(), 'Pregătește conferința');
  await pick(user, groupBox(), 'Tineret');
  expect(parentBox()).toHaveTextContent('Alege taskul-umbrelă');
  await pick(user, parentBox(), 'Tabăra de vară');
  expect(groupBox()).toHaveTextContent('Tineret');
  await user.click(screen.getByRole('button', { name: 'Continuă' }));
  expect(onDraft).toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'task', parentTaskId: 31, groupId: 4 }),
  );
});
it('locks Subtask Origin to a live parent and cannot create nested Umbrellas', async () => {
  const onDraft = vi.fn();
  render(<TaskForm options={options} onDraft={onDraft} parentTaskId={30} />);
  const user = await content();
  expect(screen.getByRole('radio', { name: 'Task-umbrelă' })).toBeDisabled();
  expect(parentBox()).toBeDisabled();
  expect(parentBox()).toHaveTextContent('Pregătește conferința');
  expect(groupBox()).toBeDisabled();
  expect(groupBox()).toHaveTextContent('Echipa afișe');
  await user.click(screen.getByRole('button', { name: 'Continuă' }));
  expect(onDraft).toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'task', parentTaskId: 30, groupId: 3 }),
  );
});
it('strips assignment and Campaign fields for an Umbrella and allows no deadline', async () => {
  const onDraft = vi.fn();
  render(<TaskForm options={options} onDraft={onDraft} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Titlu (obligatoriu)'), 'Eveniment');
  await pick(user, groupBox(), /^Echipa afișe/);
  await user.click(screen.getByRole('radio', { name: 'Task-umbrelă' }));
  expect(screen.queryByLabelText('Mod de atribuire')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Continuă' }));
  expect(onDraft).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'umbrella',
      deadline: null,
      audience: null,
      assignmentMode: null,
      executorId: null,
      campaignId: null,
    }),
  );
});
it('blocks invalid deadlines and a parent removed by a refreshed read', async () => {
  const onDraft = vi.fn();
  const view = render(
    <TaskForm options={options} onDraft={onDraft} parentTaskId={30} />,
  );
  const user = await content();
  fireEvent.change(screen.getByLabelText(/Termen/), {
    target: { value: '2027-03-28T03:30' },
  });
  await user.click(screen.getByRole('button', { name: 'Continuă' }));
  expect(screen.getByRole('alert')).toHaveTextContent('termen valid');
  view.rerender(
    <TaskForm
      options={{ ...options, umbrellas: [] }}
      onDraft={onDraft}
      parentTaskId={30}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Continuă' }));
  expect(screen.getByRole('alert')).toHaveTextContent(
    'task-umbrelă disponibil',
  );
  expect(onDraft).not.toHaveBeenCalled();
});
it('explains when the caller has no managed Groups', () => {
  render(
    <TaskForm
      options={{ groups: [], campaigns: [], umbrellas: [] }}
      onDraft={vi.fn()}
    />,
  );
  expect(
    screen.getByText('Nu ai grupuri în care poți pregăti taskuri.'),
  ).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it('drops a Campaign that a refreshed read no longer offers, instead of refusing the draft', async () => {
  const onDraft = vi.fn();
  const view = render(<TaskForm options={options} onDraft={onDraft} />);
  const user = await content();
  await pick(user, groupBox(), /^Echipa afișe/);
  await user.selectOptions(screen.getByLabelText('Campanie (opțional)'), '11');
  view.rerender(
    <TaskForm
      options={{
        ...options,
        campaigns: options.campaigns.filter((campaign) => campaign.id !== 11),
      }}
      onDraft={onDraft}
    />,
  );
  expect(screen.getByLabelText('Campanie (opțional)')).toHaveValue('');
  await user.click(screen.getByRole('button', { name: 'Continuă' }));
  expect(onDraft).toHaveBeenCalledWith(
    expect.objectContaining({ groupId: 3, campaignId: null }),
  );
});
