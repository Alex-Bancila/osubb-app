import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import axe from 'axe-core';
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
const state = vi.hoisted(() => ({
  groups: new Map<number, unknown>() as Map<number, never>,
  queue: vi.fn(),
  mutate: vi.fn(),
  scale: {
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
    data: {
      ratings: [{ rating: 5, multiplier: 4, label: 'Excelent' }],
      difficulties: [
        {
          level: 2,
          kind: 'star',
          label: '2 stele',
          glyph: null,
          base_points: 2,
        },
      ],
    },
  },
}));
vi.mock('../../queries/request-decisions', async (original) => ({
  ...(await original<object>()),
  usePendingDecisions: state.queue,
  useRequestDecision: () => ({ mutateAsync: state.mutate, isPending: false }),
}));
vi.mock('../../queries/reference', () => ({
  useEvaluationScale: () => state.scale,
  useGroups: () => ({ data: state.groups, isPending: false }),
}));
// #915: where the approver may credit the requester -- the Request's Group
// and a Child Group of it, each with its Campaigns.
const groups = vi.hoisted(() => ({
  read: vi.fn(),
  data: {
    groups: [
      { id: 3, name: 'Ateliere', path: [3], min_level: 0 },
      { id: 4, name: 'Ateliere Junior', path: [3, 4], min_level: 0 },
    ],
    groupNames: new Map([
      [3, { name: 'Ateliere' }],
      [4, { name: 'Ateliere Junior' }],
    ]),
    campaigns: [
      { id: 11, name: 'Bun venit', group_id: 3 },
      { id: 12, name: 'Doar juniori', group_id: 4 },
    ],
  },
}));
vi.mock('../../queries/completed-tasks', () => ({
  useCompletedTaskGroups: groups.read,
  useCompletedTaskExecutors: () => ({ data: [], isSuccess: true }),
}));
import { RequestDecisionQueue } from './RequestDecisionQueue';
import { CommandError } from '../../lib/command-reasons';
vi.mock(
  '../../queries/member-card',
  () => import('../../test/member-card-mock'),
);
vi.mock('../../lib/capabilities', () => ({
  useCapability: () => ({ data: false }),
}));
const request = {
  id: 7,
  requester_id: 'ana',
  requester_name: 'Ana Pop',
  group_id: 3,
  group_name: 'Ateliere',
  description: 'Am pregătit materialele.',
  created_at: '2026-09-19T12:00:00Z',
};
beforeEach(() => {
  groups.read.mockReturnValue({
    data: groups.data,
    isPending: false,
    isError: false,
  });
  state.queue.mockReturnValue({ data: [request] });
  state.mutate.mockResolvedValue({ id: 7 });
});
it('shares evaluation fields and retains success after the queue refetches empty', async () => {
  const user = userEvent.setup();
  let resolve: (value: unknown) => void = () => {};
  state.mutate.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = render(<RequestDecisionQueue />);
  await user.click(screen.getByRole('button', { name: 'Evaluează cererea' }));
  await user.click(
    screen.getByRole('button', { name: 'Aprobă și acordă punctele' }),
  );
  expect(state.mutate).not.toHaveBeenCalled();
  await user.click(screen.getByRole('radio', { name: /^2 stele — / }));
  await user.click(
    screen.getByRole('spinbutton', { name: 'Nota (obligatoriu)' }),
  );
  await user.keyboard('5');
  await user.type(
    screen.getByLabelText('Observații (obligatoriu)'),
    'Bine făcut',
  );
  await user.dblClick(
    screen.getByRole('button', { name: 'Aprobă și acordă punctele' }),
  );
  expect(state.mutate).toHaveBeenCalledTimes(1);
  // Unchanged, the Task is the Request's own text on the Request's Group.
  expect(state.mutate).toHaveBeenCalledWith({
    kind: 'approve',
    requestId: 7,
    difficulty: 2,
    rating: 5,
    note: 'Bine făcut',
    task: {
      title: 'Am pregătit materialele.',
      description: 'Am pregătit materialele.',
      groupId: 3,
      link: { label: null, url: null },
      campaignId: null,
    },
  });
  state.queue.mockReturnValue({ data: [] });
  view.rerender(<RequestDecisionQueue />);
  await act(async () => resolve({ id: 7 }));
  expect(screen.getByRole('status')).toHaveTextContent(
    'Cererea a fost aprobată',
  );
  expect(screen.getByRole('status')).toHaveFocus();
}, 20_000);
it('requires a rejection note, calls rejection only, and has no axe violations', async () => {
  const user = userEvent.setup();
  const { container } = render(<RequestDecisionQueue />);
  await user.click(screen.getByRole('button', { name: 'Respinge' }));
  // Nothing is disabled before the first try; the rule shows under the field.
  await user.click(screen.getByRole('button', { name: 'Respinge cererea' }));
  expect(
    screen.getByLabelText('Motivul respingerii (obligatoriu)'),
  ).toHaveAccessibleDescription('Scrie motivul respingerii.');
  expect(state.mutate).not.toHaveBeenCalled();
  await user.type(
    screen.getByLabelText('Motivul respingerii (obligatoriu)'),
    'Mai sunt necesare detalii',
  );
  expect(
    (
      await axe.run(container, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
  await user.click(screen.getByRole('button', { name: 'Respinge cererea' }));
  expect(state.mutate).toHaveBeenCalledWith({
    kind: 'reject',
    requestId: 7,
    note: 'Mai sunt necesare detalii',
  });
  expect(await screen.findByRole('status')).toHaveTextContent('respinsă');
});
it('evaluates in a dialog with the dialog header, listing the Request once (#855, R1)', async () => {
  const user = userEvent.setup();
  render(<RequestDecisionQueue />);
  await user.click(screen.getByRole('button', { name: 'Evaluează cererea' }));
  const dialog = await screen.findByRole('dialog', {
    name: 'Evaluează cererea',
  });
  expect(
    dialog.querySelector(
      '[data-slot="dialog-header"] [data-slot="dialog-title"]',
    ),
  ).toHaveTextContent('Evaluează cererea');
  // The form is not a second box with its own title inside the dialog: its
  // two blocks are the Task and its Evaluation (#915).
  expect(
    within(dialog)
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent),
  ).toEqual(['Taskul', 'Evaluarea']);
  expect(
    within(dialog)
      .getByRole('button', { name: 'Aprobă și acordă punctele' })
      .closest('[data-slot="dialog-footer"]'),
  ).not.toBeNull();
  // The Request under decision shows once in the dialog, and the list keeps
  // its one row instead of gaining a copy.
  // (The Task's Detalii, prefilled from it, is a field, not a second copy.)
  expect(
    within(dialog).getAllByText(request.description, { selector: 'p' }),
  ).toHaveLength(1);
  expect(screen.getAllByRole('listitem', { hidden: true })).toHaveLength(1);
  expect(
    screen.getAllByText(request.description, { selector: 'p' }),
  ).toHaveLength(2);
  await user.click(within(dialog).getByRole('button', { name: 'Renunță' }));
  expect(state.mutate).not.toHaveBeenCalled();
});
it('says there is nothing to decide when the queue is the page (#855, B30)', () => {
  state.queue.mockReturnValue({ data: [] });
  render(<RequestDecisionQueue showEmpty />);
  expect(
    screen.getByRole('heading', { name: 'Cereri de evaluat' }),
  ).toBeVisible();
  expect(screen.getByText('Nicio cerere de evaluat.')).toBeVisible();
});
it('stays hidden for a member with nothing to decide, including while it loads', () => {
  state.queue.mockReturnValue({ data: [] });
  const view = render(<RequestDecisionQueue />);
  expect(view.container).toBeEmptyDOMElement();
  state.queue.mockReturnValue({ isPending: true });
  view.rerender(<RequestDecisionQueue />);
  expect(view.container).toBeEmptyDOMElement();
});
it('offers a retry when the decision queue cannot be read', async () => {
  const refetch = vi.fn();
  state.queue.mockReturnValue({ isError: true, refetch });
  render(<RequestDecisionQueue />);
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Nu am putut încărca cererile de evaluat.',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Reîncearcă' }));
  expect(refetch).toHaveBeenCalled();
});
it('keeps the request and note on unexpected failure without leaking details', async () => {
  state.mutate.mockRejectedValue(new Error('private SQL'));
  render(<RequestDecisionQueue />);
  await userEvent.click(screen.getByRole('button', { name: 'Respinge' }));
  await userEvent.type(
    screen.getByLabelText('Motivul respingerii (obligatoriu)'),
    'Notă',
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Respinge cererea' }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Nu am putut salva decizia',
  );
  expect(screen.queryByText(/private SQL/)).not.toBeInTheDocument();
  expect(
    screen.getByLabelText('Motivul respingerii (obligatoriu)'),
  ).toHaveValue('Notă');
});
it('names the Requester by Nickname as a button that opens their Member Card', async () => {
  state.queue.mockReturnValue({
    data: [{ ...request, requester_nickname: 'Ani' }],
  });
  render(<RequestDecisionQueue />);
  const name = screen.getByRole('button', { name: 'Profilul membrului Ani' });
  // Name and Group on their own lines: no separator left at a line's end (R2).
  expect(name.closest('p')).toHaveTextContent(/Ani$/);
  expect(screen.getByText('Ateliere')).toHaveAttribute(
    'data-slot',
    'request-group',
  );
  expect(screen.getByRole('listitem')).not.toHaveTextContent('·');
  expect(name).not.toHaveTextContent('Ana Pop');
  await userEvent.click(name);
  expect(await screen.findByRole('dialog', { name: 'Ani' })).toBeVisible();
});

async function score(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('radio', { name: /^2 stele — / }));
  await user.click(
    screen.getByRole('spinbutton', { name: 'Nota (obligatoriu)' }),
  );
  await user.keyboard('5');
  await user.type(screen.getByLabelText('Observații (obligatoriu)'), 'Bine');
}

it('prefills the Task from the Request and approves it as the decider shaped it (#915)', async () => {
  const user = userEvent.setup();
  render(<RequestDecisionQueue />);
  await user.click(screen.getByRole('button', { name: 'Evaluează cererea' }));
  const dialog = await screen.findByRole('dialog', {
    name: 'Evaluează cererea',
  });
  expect(groups.read).toHaveBeenCalledWith('ana');
  // The requester, as a Member Card button (the path rule for names).
  // The requester is named once, by the Request summary, as a Member Card.
  expect(
    within(dialog).getAllByRole('button', {
      name: 'Profilul membrului Ana Pop',
    }),
  ).toHaveLength(1);
  expect(dialog.querySelector('[data-slot="completed-volunteer"]')).toBeNull();
  const title = within(dialog).getByLabelText('Titlu (obligatoriu)');
  expect(title).toHaveValue(request.description);
  expect(within(dialog).getByLabelText('Detalii')).toHaveValue(
    request.description,
  );
  expect(
    within(dialog).getByRole('combobox', {
      name: 'Grup principal (obligatoriu)',
    }),
  ).toHaveTextContent('Ateliere');
  // No deadline and no Audience: a completed Task is no Opportunity.
  expect(within(dialog).queryByLabelText(/Termen/)).toBeNull();
  expect(within(dialog).queryByLabelText(/Audiență/)).toBeNull();

  await user.clear(title);
  await user.type(title, 'Materiale pentru atelier');
  await user.clear(within(dialog).getByLabelText('Detalii'));
  await user.selectOptions(
    within(dialog).getByLabelText('Campanie (opțional)'),
    '11',
  );
  // Moving the work to the Child Group keeps a Campaign owned above it.
  await user.click(
    within(dialog).getByRole('combobox', { name: 'Subgrup (opțional)' }),
  );
  await user.click(
    await screen.findByRole('option', { name: /^Ateliere Junior/ }),
  );
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  await user.type(within(dialog).getByLabelText('Etichetă link'), 'Poze');
  await user.type(
    within(dialog).getByLabelText('Adresă link'),
    'https://example.org/poze',
  );
  await score(user);
  await user.click(
    screen.getByRole('button', { name: 'Aprobă și acordă punctele' }),
  );
  expect(state.mutate).toHaveBeenCalledWith({
    kind: 'approve',
    requestId: 7,
    difficulty: 2,
    rating: 5,
    note: 'Bine',
    task: {
      title: 'Materiale pentru atelier',
      description: null,
      groupId: 4,
      link: { label: 'Poze', url: 'https://example.org/poze' },
      campaignId: 11,
    },
  });
  // A long form: slow under the full parallel run.
}, 20_000);

it('shows a refusal about the requester under Grup, in Romanian (#915)', async () => {
  const user = userEvent.setup();
  state.mutate.mockRejectedValue(
    new CommandError(
      { code: 'PT409', message: 'executor_not_group_member' },
      'fallback',
    ),
  );
  render(<RequestDecisionQueue />);
  await user.click(screen.getByRole('button', { name: 'Evaluează cererea' }));
  await score(user);
  await user.click(
    screen.getByRole('button', { name: 'Aprobă și acordă punctele' }),
  );
  const group = await screen.findByRole('combobox', {
    name: 'Grup principal (obligatoriu)',
  });
  await waitFor(() =>
    expect(group).toHaveAccessibleDescription(
      'Voluntarul nu face parte din grupul ales sau din subgrupurile lui. Alege alt grup.',
    ),
  );
});

it("always offers the Request's own Group, even when the read leaves it out (#915)", async () => {
  const user = userEvent.setup();
  groups.read.mockReturnValue({
    data: { ...groups.data, groups: [groups.data.groups[1]] },
    isPending: false,
    isError: false,
  });
  render(<RequestDecisionQueue />);
  await user.click(screen.getByRole('button', { name: 'Evaluează cererea' }));
  expect(
    screen.getByRole('combobox', { name: 'Grup principal (obligatoriu)' }),
  ).toHaveTextContent('Ateliere');
});

it('sets the approval Evaluation from the guide of the Request Group (#986)', async () => {
  const user = userEvent.setup();
  // The Request's Group is Human Resources (HR), with its own list.
  state.groups = new Map([
    [
      3,
      {
        id: 3,
        name: 'Ateliere',
        short: 'HR',
        category: 'department',
        path: [3],
        is_organization: false,
      },
    ],
  ]) as never;
  render(<RequestDecisionQueue />);
  await user.click(screen.getByRole('button', { name: 'Evaluează cererea' }));
  await user.click(screen.getByRole('button', { name: 'Ghid de evaluare' }));
  const guide = await screen.findByRole('dialog', { name: 'Ghid de evaluare' });
  expect(
    within(guide).getByRole('region', { name: 'Taskuri în Resurse Umane' }),
  ).toBeVisible();
  await user.click(
    within(guide).getByRole('button', {
      name: 'Setează Dificultate 2 stele — Remindere',
    }),
  );
  await user.click(within(guide).getByRole('button', { name: 'Gata' }));
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'Ghid de evaluare' }),
    ).toBeNull(),
  );
  expect(screen.getByRole('radio', { name: /^2 stele — / })).toBeChecked();
  state.groups = new Map() as never;
});
