import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, expect, it, vi } from 'vitest';
import { CommandError } from '../../lib/command-reasons';
import { findFormattedText } from '../../test/formatted-text';
import { chooseOption } from '../../test/select';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
const state = vi.hoisted(() => ({
  groups: new Map<number, unknown>() as Map<number, never>,
  manage: { data: true as boolean | undefined },
  create: vi.fn(),
  createMany: vi.fn(),
  executors: vi.fn(),
  scale: {
    isPending: false,
    isError: false,
    data: {
      ratings: [{ rating: 5, multiplier: 3, label: 'Excelent' }],
      difficulties: [
        {
          level: 4,
          kind: 'star',
          label: '4 stele',
          glyph: null,
          base_points: 4,
        },
      ],
    },
  },
}));
vi.mock('../../queries/task-tabs', () => ({
  useTaskManagement: () => state.manage,
}));
vi.mock('../../queries/reference', () => ({
  useEvaluationScale: () => state.scale,
  useGroups: () => ({ data: state.groups, isPending: false }),
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
  useCreateCompletedTasks: () => ({
    mutateAsync: state.createMany,
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
  state.createMany.mockResolvedValue([{ id: 51, title: 'Atelier' }]);
});

type User = ReturnType<typeof userEvent.setup>;
async function pick(user: User, box: HTMLElement, name: RegExp | string) {
  await user.click(box);
  await user.click(await screen.findByRole('option', { name }));
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
}
const volunteerBox = () => screen.getByRole('combobox', { name: 'Voluntar' });

async function open(user: User) {
  render(<AddCompletedTaskControl onAdded={onAdded} />);
  await user.click(
    screen.getByRole('button', { name: 'Adaugă task finalizat' }),
  );
  return screen.findByRole('dialog', { name: 'Adaugă task finalizat' });
}

async function evaluate(user: User, dialog: HTMLElement) {
  await user.click(within(dialog).getByRole('radio', { name: /^4 stele — / }));
  await user.click(within(dialog).getByRole('spinbutton', { name: 'Nota' }));
  await user.keyboard('5');
  await user.type(within(dialog).getByLabelText('Observații'), 'Excelent');
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
  // A form sheet with no intro paragraph and its actions pinned.
  expect(dialog).toHaveAttribute('data-slot', 'form-sheet');
  expect(dialog).not.toHaveTextContent(/Înregistrează munca/);
  expect(
    within(dialog)
      .getByRole('button', { name: 'Adaugă și acordă punctele' })
      .closest('[data-slot="sheet-footer"][data-pinned]'),
  ).not.toBeNull();
  expect(dialog).not.toHaveTextContent('(obligatoriu)');
  expect(
    within(dialog).getByText(
      'Alege întâi grupul: lista arată pe cine poți credita acolo.',
    ),
  ).toBeVisible();
  await pick(
    user,
    within(dialog).getByRole('combobox', {
      name: 'Grup principal',
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
      name: 'Grup principal',
    }),
    /^Educație/,
  );
  await pick(
    user,
    within(dialog).getByRole('combobox', { name: 'Subgrup (opțional)' }),
    /^Mentorat/,
  );
  await pick(user, volunteerBox(), 'Ana');
  await user.type(within(dialog).getByLabelText('Titlu'), '  Atelier  ');
  await user.type(
    await findFormattedText('Detalii (opțional)', dialog),
    'Sala 2',
  );
  await chooseOption(
    user,
    within(dialog).getByLabelText('Campanie (opțional)'),
    'Bun venit',
  );
  await user.click(within(dialog).getByRole('button', { name: 'Adaugă link' }));
  await user.type(within(dialog).getByLabelText('Etichetă link 1'), 'Poze');
  await user.type(
    within(dialog).getByLabelText('Adresă link 1'),
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
  expect(state.createMany).toHaveBeenCalledWith({
    draft: {
      executorId: 'ana',
      groupId: 9,
      title: 'Atelier',
      description: 'Sala 2',
      links: [{ label: 'Poze', url: 'https://example.org' }],
      campaignId: 3,
      difficulty: 4,
      rating: 5,
      note: 'Excelent',
      copies: 1,
    },
  });
  expect(onAdded).toHaveBeenCalledWith({ ids: [51], title: 'Atelier' });
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
  expect(state.createMany).not.toHaveBeenCalled();
  expect(
    within(dialog).getByText('Alege exact un grup de origine.'),
  ).toBeVisible();
  expect(within(dialog).getByText('Alege voluntarul.')).toBeVisible();
  expect(within(dialog).getByLabelText('Titlu')).toHaveAccessibleDescription(
    'Scrie titlul.',
  );
  expect(within(dialog).getByText('Alege Dificultatea.')).toBeVisible();
  expect(within(dialog).getByText('Alege Nota.')).toBeVisible();
});

it('puts a server refusal under the field it names, in Romanian', async () => {
  const user = userEvent.setup();
  state.createMany.mockRejectedValue(
    new CommandError(
      { code: 'PT409', message: 'executor_role_excluded' },
      'fallback',
    ),
  );
  const dialog = await open(user);
  await pick(
    user,
    within(dialog).getByRole('combobox', {
      name: 'Grup principal',
    }),
    /^Educație/,
  );
  await pick(user, volunteerBox(), 'Bogdan');
  await user.type(within(dialog).getByLabelText('Titlu'), 'Stand');
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
  expect(within(dialog).getByLabelText('Titlu')).toHaveValue('Stand');
});

it('puts a server refusal of the Detalii under them (R60)', async () => {
  const user = userEvent.setup();
  state.createMany.mockRejectedValue(
    new CommandError(
      { code: 'PT400', message: 'description_too_long' },
      'fallback',
    ),
  );
  const dialog = await open(user);
  await pick(
    user,
    within(dialog).getByRole('combobox', {
      name: 'Grup principal',
    }),
    /^Educație/,
  );
  await pick(user, volunteerBox(), 'Bogdan');
  await user.type(within(dialog).getByLabelText('Titlu'), 'Stand');
  const details = await findFormattedText('Detalii (opțional)', dialog);
  await user.type(details, 'Sala 2');
  await evaluate(user, dialog);
  await user.click(
    within(dialog).getByRole('button', { name: 'Adaugă și acordă punctele' }),
  );

  await waitFor(() =>
    expect(details).toHaveAccessibleDescription(
      /Descrierea are cel mult 2000 de caractere\./,
    ),
  );
  expect(details).toHaveAttribute('aria-invalid', 'true');
  expect(onAdded).not.toHaveBeenCalled();
});

it('sets the Evaluation from the guide of the chosen Group (#986)', async () => {
  const user = userEvent.setup();
  state.groups = new Map([
    [
      7,
      {
        id: 7,
        name: 'Educație',
        short: 'EDU',
        category: 'department',
        path: [7],
        is_organization: false,
      },
    ],
    [
      9,
      {
        id: 9,
        name: 'Mentorat',
        short: null,
        category: 'team',
        path: [7, 9],
        is_organization: false,
      },
    ],
  ]) as never;
  const dialog = await open(user);
  await pick(
    user,
    within(dialog).getByRole('combobox', {
      name: 'Grup principal',
    }),
    /^Educație/,
  );
  await pick(
    user,
    within(dialog).getByRole('combobox', { name: 'Subgrup (opțional)' }),
    /^Mentorat/,
  );
  await user.click(
    within(dialog).getByRole('button', { name: 'Ghid de evaluare' }),
  );
  const guide = await screen.findByRole('dialog', { name: 'Ghid de evaluare' });
  // Mentorat sits under Educație (EDU): the EDU list.
  await user.click(
    within(guide).getByRole('button', {
      name: 'Setează Începător, Dificultate 4 stele — Scriere postări',
    }),
  );
  await user.click(
    within(guide).getByRole('button', { name: 'Note și dificultăți' }),
  );
  await user.click(
    within(guide).getByRole('button', { name: 'Setează Nota 5' }),
  );
  await user.click(within(guide).getByRole('button', { name: 'Gata' }));
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'Ghid de evaluare' }),
    ).toBeNull(),
  );
  expect(
    within(dialog).getByRole('radio', { name: /^4 stele — / }),
  ).toBeChecked();
  expect(
    within(dialog).getByRole('spinbutton', { name: 'Nota' }),
  ).toHaveAttribute('aria-valuenow', '5');
  expect(within(dialog).getByText(/Previzualizare: 12 puncte/)).toBeVisible();
  state.groups = new Map() as never;
});

it('adds the same finished Task for three volunteers at once, the same person allowed twice (Part E)', async () => {
  state.createMany.mockResolvedValue([
    { id: 71, title: 'Atelier' },
    { id: 72, title: 'Atelier' },
    { id: 73, title: 'Atelier' },
  ]);
  const user = userEvent.setup();
  const dialog = await open(user);
  await pick(
    user,
    within(dialog).getByRole('combobox', { name: 'Grup principal' }),
    /^Educație/,
  );
  const copies = within(dialog).getByLabelText('Exemplare');
  expect(copies).toHaveValue(1);
  expect(copies).toHaveAttribute('max', '100');
  await user.clear(copies);
  await user.type(copies, '3');
  // The volunteers come in the next step; the picker gives way.
  expect(
    within(dialog).queryByRole('combobox', { name: 'Voluntar' }),
  ).toBeNull();
  expect(
    within(dialog).getByText(
      'Voluntarii se aleg la pasul următor, câte unul pentru fiecare exemplar.',
    ),
  ).toBeVisible();
  expect(
    within(dialog).queryByRole('button', { name: 'Adaugă și acordă punctele' }),
  ).toBeNull();
  await user.type(within(dialog).getByLabelText('Titlu'), 'Atelier');
  await evaluate(user, dialog);
  await user.click(within(dialog).getByRole('button', { name: 'Continuă' }));
  const step = await screen.findByRole('dialog', {
    name: 'Voluntarii celor 3 taskuri finalizate',
  });
  expect(step).toHaveAccessibleDescription(
    'Alege câte un voluntar pentru fiecare exemplar.',
  );
  await pick(
    user,
    within(step).getByRole('combobox', { name: 'Exemplarul 1' }),
    'Ana',
  );
  // Ana again: a repeat is allowed here.
  await pick(
    user,
    within(step).getByRole('combobox', { name: 'Exemplarul 2' }),
    'Ana',
  );
  await pick(
    user,
    within(step).getByRole('combobox', { name: 'Exemplarul 3' }),
    'Bogdan',
  );
  await user.click(
    within(step).getByRole('button', {
      name: 'Adaugă 3 taskuri și acordă punctele',
    }),
  );
  await waitFor(() =>
    expect(onAdded).toHaveBeenCalledWith({
      ids: [71, 72, 73],
      title: 'Atelier',
    }),
  );
  expect(state.createMany).toHaveBeenCalledWith({
    draft: expect.objectContaining({
      copies: 3,
      groupId: 7,
      title: 'Atelier',
      executorId: null,
    }),
    executorIds: ['ana', 'ana', 'bogdan'],
  });
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'Adaugă task finalizat' }),
    ).toBeNull(),
  );
  // Two dialogs and six picks: slow under the full parallel run.
}, 20_000);

it('keeps the draft when the second step goes back, and shows a batch refusal there', async () => {
  state.createMany.mockRejectedValue(
    new CommandError(
      { code: 'PT409', message: 'executor_role_excluded' },
      'fallback',
    ),
  );
  const user = userEvent.setup();
  const dialog = await open(user);
  await pick(
    user,
    within(dialog).getByRole('combobox', { name: 'Grup principal' }),
    /^Educație/,
  );
  const copies = within(dialog).getByLabelText('Exemplare');
  await user.clear(copies);
  await user.type(copies, '2');
  await user.type(within(dialog).getByLabelText('Titlu'), 'Stand');
  await evaluate(user, dialog);
  await user.click(within(dialog).getByRole('button', { name: 'Continuă' }));
  let step = await screen.findByRole('dialog', {
    name: 'Voluntarii celor 2 taskuri finalizate',
  });
  await user.click(within(step).getByRole('button', { name: 'Înapoi' }));
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', {
        name: 'Voluntarii celor 2 taskuri finalizate',
      }),
    ).toBeNull(),
  );
  expect(within(dialog).getByLabelText('Titlu')).toHaveValue('Stand');
  expect(state.createMany).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole('button', { name: 'Continuă' }));
  step = await screen.findByRole('dialog', {
    name: 'Voluntarii celor 2 taskuri finalizate',
  });
  await pick(
    user,
    within(step).getByRole('combobox', { name: 'Exemplarul 1' }),
    'Ana',
  );
  await pick(
    user,
    within(step).getByRole('combobox', { name: 'Exemplarul 2' }),
    'Bogdan',
  );
  await user.click(
    within(step).getByRole('button', {
      name: 'Adaugă 2 taskuri și acordă punctele',
    }),
  );
  expect(
    await within(step).findByText(
      'BC și Moderatorul nu primesc taskuri. Alege alt voluntar.',
    ),
  ).toBeVisible();
  expect(onAdded).not.toHaveBeenCalled();
}, 20_000);
