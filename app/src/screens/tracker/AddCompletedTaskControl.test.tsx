import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, expect, it, vi } from 'vitest';
import { CommandError } from '../../lib/command-reasons';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
const state = vi.hoisted(() => ({
  manage: { data: true as boolean | undefined },
  create: vi.fn(),
  executors: vi.fn(),
  scale: {
    isPending: false,
    isError: false,
    data: {
      ratings: [{ rating: 5, multiplier: 3, label: 'Excelent' }],
      difficulties: [{ stars: 4, note: 'Greu' }],
    },
  },
}));
vi.mock('../../queries/task-tabs', () => ({
  useTaskManagement: () => state.manage,
}));
vi.mock('../../queries/reference', () => ({
  useEvaluationScale: () => state.scale,
}));
// Dept 7 and its Team 9; Ana belongs to the Team, Bogdan only to the Dept.
const people = {
  ana: { id: 'ana', name: 'Ana', avatarColor: null },
  bogdan: { id: 'bogdan', name: 'Bogdan', avatarColor: null },
};
vi.mock('../../queries/completed-tasks', () => ({
  useCompletedTaskOptions: () => ({
    isPending: false,
    isError: false,
    data: {
      groups: [
        { id: 7, name: 'Educație', path: [7], min_level: 0 },
        { id: 9, name: 'Mentorat', path: [7, 9], min_level: 0 },
      ],
      groupNames: new Map([
        [7, { name: 'Educație' }],
        [9, { name: 'Mentorat' }],
      ]),
      campaigns: [{ id: 3, name: 'Bun venit', group_id: 9 }],
    },
  }),
  useCompletedTaskExecutors: state.executors,
  useCreateCompletedTask: () => ({
    mutateAsync: state.create,
    isPending: false,
  }),
}));
import { AddCompletedTaskControl } from './AddCompletedTaskControl';

const onAdded = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  state.manage = { data: true };
  state.executors.mockImplementation((groupId: number | null) => ({
    isPending: false,
    isError: false,
    isSuccess: groupId !== null,
    data:
      groupId === 7
        ? [people.ana, people.bogdan]
        : groupId === 9
          ? [people.ana]
          : undefined,
  }));
  state.create.mockResolvedValue({ id: 51, title: 'Atelier' });
});

type User = ReturnType<typeof userEvent.setup>;
async function pick(user: User, box: HTMLElement, name: RegExp | string) {
  await user.click(box);
  await user.click(await screen.findByRole('option', { name }));
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
}
const volunteerBox = () =>
  screen.getByRole('combobox', { name: 'Voluntar (obligatoriu)' });

async function open(user: User) {
  render(<AddCompletedTaskControl onAdded={onAdded} />);
  await user.click(
    screen.getByRole('button', { name: 'Adaugă task finalizat' }),
  );
  return screen.findByRole('dialog', { name: 'Adaugă task finalizat' });
}

async function evaluate(user: User, dialog: HTMLElement) {
  await user.click(
    within(dialog).getByRole('radio', { name: '4 stele — Greu' }),
  );
  await user.click(
    within(dialog).getByRole('spinbutton', { name: 'Nota (obligatoriu)' }),
  );
  await user.keyboard('5');
  await user.type(
    within(dialog).getByLabelText('Observații (obligatoriu)'),
    'Excelent',
  );
}

it('is offered only to a viewer who may create Tasks, beside "Task nou" (#915)', () => {
  state.manage = { data: false };
  const view = render(<AddCompletedTaskControl onAdded={onAdded} />);
  expect(view.container).toBeEmptyDOMElement();
  state.manage = { data: undefined };
  view.rerender(<AddCompletedTaskControl onAdded={onAdded} />);
  expect(view.container).toBeEmptyDOMElement();
  state.manage = { data: true };
  view.rerender(<AddCompletedTaskControl onAdded={onAdded} />);
  expect(
    screen.getByRole('button', { name: 'Adaugă task finalizat' }),
  ).toBeVisible();
});

it('lists the volunteers of the chosen Group and re-filters them when the Group changes', async () => {
  const user = userEvent.setup();
  const dialog = await open(user);
  expect(
    within(dialog).getByText('Alege întâi grupul: lista arată membrii lui.'),
  ).toBeVisible();
  await pick(
    user,
    within(dialog).getByRole('combobox', {
      name: 'Grup principal (obligatoriu)',
    }),
    /^Educație/,
  );
  expect(state.executors).toHaveBeenLastCalledWith(7);
  await pick(user, volunteerBox(), 'Bogdan');
  expect(volunteerBox()).toHaveTextContent('Bogdan');
  // Mentorat does not offer Bogdan: the choice is cleared, never kept.
  await pick(
    user,
    within(dialog).getByRole('combobox', { name: 'Subgrup (opțional)' }),
    /^Mentorat/,
  );
  expect(state.executors).toHaveBeenLastCalledWith(9);
  await waitFor(() =>
    expect(volunteerBox()).toHaveTextContent('Alege un membru'),
  );
  await user.click(volunteerBox());
  const options = within(await screen.findByRole('listbox')).getAllByRole(
    'option',
  );
  expect(options).toHaveLength(1);
  expect(options[0]).toHaveTextContent(/Ana$/);
});

it('adds the completed Task with every chosen field and reports it (#915)', async () => {
  const user = userEvent.setup();
  const dialog = await open(user);
  // No deadline and no Audience on a completed Task.
  expect(within(dialog).queryByLabelText(/Termen/)).toBeNull();
  expect(within(dialog).queryByLabelText(/Audiență/)).toBeNull();
  await pick(
    user,
    within(dialog).getByRole('combobox', {
      name: 'Grup principal (obligatoriu)',
    }),
    /^Educație/,
  );
  await pick(
    user,
    within(dialog).getByRole('combobox', { name: 'Subgrup (opțional)' }),
    /^Mentorat/,
  );
  await pick(user, volunteerBox(), 'Ana');
  await user.type(
    within(dialog).getByLabelText('Titlu (obligatoriu)'),
    '  Atelier  ',
  );
  await user.type(within(dialog).getByLabelText('Detalii'), 'Sala 2');
  await user.selectOptions(
    within(dialog).getByLabelText('Campanie (opțional)'),
    '3',
  );
  await user.type(within(dialog).getByLabelText('Etichetă link'), 'Poze');
  await user.type(
    within(dialog).getByLabelText('Adresă link'),
    'https://example.org',
  );
  await evaluate(user, dialog);
  expect(within(dialog).getByText(/Previzualizare: 12 puncte/)).toBeVisible();
  expect(
    (
      await axe.run(dialog, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
  await user.click(
    within(dialog).getByRole('button', { name: 'Adaugă și acordă punctele' }),
  );
  expect(state.create).toHaveBeenCalledWith({
    executorId: 'ana',
    groupId: 9,
    title: 'Atelier',
    description: 'Sala 2',
    link: { label: 'Poze', url: 'https://example.org' },
    campaignId: 3,
    difficulty: 4,
    rating: 5,
    note: 'Excelent',
  });
  expect(onAdded).toHaveBeenCalledWith({ id: 51, title: 'Atelier' });
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'Adaugă task finalizat' }),
    ).toBeNull(),
  );
  // A long form plus an axe pass: slow under the full parallel run.
}, 20_000);

it('asks for the Group, the volunteer, the title and the scores before sending', async () => {
  const user = userEvent.setup();
  const dialog = await open(user);
  await user.click(
    within(dialog).getByRole('button', { name: 'Adaugă și acordă punctele' }),
  );
  expect(state.create).not.toHaveBeenCalled();
  expect(
    within(dialog).getByText('Alege exact un grup de origine.'),
  ).toBeVisible();
  expect(within(dialog).getByText('Alege voluntarul.')).toBeVisible();
  expect(
    within(dialog).getByLabelText('Titlu (obligatoriu)'),
  ).toHaveAccessibleDescription('Scrie titlul.');
  expect(within(dialog).getByText('Alege Dificultatea.')).toBeVisible();
  expect(within(dialog).getByText('Alege Nota.')).toBeVisible();
});

it('puts a server refusal under the field it names, in Romanian', async () => {
  const user = userEvent.setup();
  state.create.mockRejectedValue(
    new CommandError(
      { code: 'PT409', message: 'executor_role_excluded' },
      'fallback',
    ),
  );
  const dialog = await open(user);
  await pick(
    user,
    within(dialog).getByRole('combobox', {
      name: 'Grup principal (obligatoriu)',
    }),
    /^Educație/,
  );
  await pick(user, volunteerBox(), 'Bogdan');
  await user.type(
    within(dialog).getByLabelText('Titlu (obligatoriu)'),
    'Stand',
  );
  await evaluate(user, dialog);
  await user.click(
    within(dialog).getByRole('button', { name: 'Adaugă și acordă punctele' }),
  );
  expect(
    await within(dialog).findByText(
      'BC și Moderatorul nu primesc taskuri. Alege alt voluntar.',
    ),
  ).toBeVisible();
  expect(onAdded).not.toHaveBeenCalled();
  // The draft stays for another try.
  expect(within(dialog).getByLabelText('Titlu (obligatoriu)')).toHaveValue(
    'Stand',
  );
});
