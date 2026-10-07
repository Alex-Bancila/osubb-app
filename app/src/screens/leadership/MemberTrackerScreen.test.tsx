import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

// #1012 (R37): opening a thing reads its Notifications. The hook is observed
// here; its own behaviour is covered in queries/notifications-read.test.tsx.
const readNotificationsAbout = vi.hoisted(() => vi.fn());
vi.mock('../../queries/notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../queries/notifications')>()),
  useReadNotificationsAbout: readNotificationsAbout,
}));
import axe from 'axe-core';
const state = vi.hoisted(() => ({
  history: vi.fn(),
  options: vi.fn(),
  total: vi.fn(),
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../queries/leadership', () => ({
  useLeadershipMemberTasks: state.history,
  useLeadershipFilters: state.options,
  useLeadershipMemberTotal: state.total,
}));
vi.mock('../../queries/task-tabs', () => ({
  useTaskLeadership: () => ({ data: true }),
}));
import MemberTrackerScreen from './MemberTrackerScreen';
vi.mock(
  '../../queries/member-card',
  () => import('../../test/member-card-mock'),
);
vi.mock('../../lib/capabilities', () => ({
  useCapability: () => ({ data: false }),
}));
// #915: "Adaugă task finalizat" reads where the viewer may credit this Member.
const completed = vi.hoisted(() => ({
  groups: vi.fn(),
  create: vi.fn(),
  scale: {
    isPending: false,
    isError: false,
    data: {
      ratings: [{ rating: 4, multiplier: 2, label: 'Foarte bun' }],
      difficulties: [
        {
          level: 3,
          kind: 'star',
          label: '3 stele',
          glyph: null,
          base_points: 3,
        },
      ],
    },
  },
}));
vi.mock('../../queries/completed-tasks', () => ({
  useCompletedTaskGroups: completed.groups,
  useCompletedTaskExecutors: () => ({ data: [], isSuccess: true }),
  useCompletedTaskOptions: () => ({ isPending: true }),
  useCreateCompletedTask: () => ({
    mutateAsync: completed.create,
    isPending: false,
  }),
}));
vi.mock('../../queries/reference', async (original) => ({
  ...(await original<object>()),
  useEvaluationScale: () => completed.scale,
}));
import { closeFilters, openFilters } from '../../test/filters';
import { useMemberCard } from '../../test/member-card-mock';
const uid = '35400000-0000-0000-0000-000000000001';
function view(id = uid, query = '', from?: unknown) {
  return render(
    <MemoryRouter
      initialEntries={[
        { pathname: `/tracker/membru/${id}`, search: query, state: from },
      ]}
    >
      <main>
        <Routes>
          <Route path="/tracker/membru/:id" element={<MemberTrackerScreen />} />
        </Routes>
      </main>
    </MemoryRouter>,
  );
}
const workshop = {
  assignment_id: 1,
  task_id: 41,
  title: 'Pregătește atelierul',
  description: 'Sala 2, flipchart',
  status: 'completed',
  task_kind: 'task',
  assignment_mode: 'direct',
  audience: 'local',
  group_id: 9,
  group_name: 'Mentorat',
  campaign_id: 3,
  campaign_name: 'Bun venit',
  parent_task_id: null,
  review_round: 0,
  assigned_at: '2026-09-10T10:00:00Z',
  deadline: '2026-09-12T15:00:00Z',
  completed_at: '2026-09-12T10:00:00Z',
  completed_late: false,
  is_overdue: false,
  assignment_ended_at: '2026-09-12T10:00:00Z',
  assignment_end_reason: 'completed',
  evaluation_history: [
    {
      id: 2,
      outcome: 'completed',
      points: -1234,
      difficulty: 3,
      rating: 4,
      note: 'Bine pregătit',
      evaluated_at: '2026-09-12T10:00:00Z',
      reversed_at: '2026-09-13T10:00:00Z',
      reversal_reason: 'Corecție',
    },
    {
      id: 3,
      outcome: 'completed',
      points: 18,
      difficulty: 3,
      rating: 5,
      note: null,
      evaluated_at: '2026-09-14T10:00:00Z',
      reversed_at: null,
      reversal_reason: null,
    },
  ],
  subtasks: [{ id: 5, title: 'Materiale', status: 'completed' }],
};
const budget = {
  ...workshop,
  assignment_id: 2,
  task_id: 42,
  title: 'Bugetul trimestrial',
  description: null,
  status: 'in_progress',
  group_id: 11,
  group_name: 'Financiar',
  campaign_id: null,
  campaign_name: null,
  completed_at: null,
  assignment_ended_at: null,
  assignment_end_reason: null,
  evaluation_history: [],
  subtasks: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  completed.groups.mockReturnValue({
    data: { groups: [], groupNames: new Map(), campaigns: [] },
    isPending: false,
    isError: false,
  });
  state.history.mockReturnValue({ data: [workshop, budget] });
  state.total.mockReturnValue({ data: 12, isPending: false, isError: false });
  state.options.mockReturnValue({
    data: {
      groups: [
        {
          id: 7,
          name: 'Educație',
          path: [7],
          status: 'active',
          is_organization: false,
          color: '#284C93',
          category: 'department',
        },
        {
          id: 9,
          name: 'Mentorat',
          path: [7, 9],
          status: 'active',
          is_organization: false,
          color: '#284C93',
          category: 'team',
        },
        {
          id: 11,
          name: 'Financiar',
          path: [11],
          status: 'active',
          is_organization: false,
          color: '#007F33',
          category: 'department',
        },
      ],
      campaigns: [{ id: 3, name: 'Bun venit', group_id: 7 }],
    },
  });
  useMemberCard.mockReturnValue({
    data: {
      memberId: uid,
      nickname: 'Ioana',
      fullName: 'Ioana Popescu',
      roleLabel: 'Voluntar Activ',
      joinedAt: null,
      avatarColor: null,
      primaryGroup: { id: 7, name: 'Educație', color: '#284C93' },
      otherMemberships: 1,
      groups: [
        {
          id: 7,
          name: 'Educație',
          label: 'Educație',
          color: '#284C93',
          roleLabel: 'Membru',
        },
        {
          id: 9,
          name: 'Mentorat',
          label: 'Mentorat · Educație',
          color: '#284C93',
          roleLabel: 'Membru',
        },
      ],
      contact: null,
    },
    isPending: false,
    isError: false,
    refetch: async () => {},
  } as never);
});
function cards() {
  return within(
    screen.getByRole('region', { name: 'Atribuiri' }),
  ).queryAllByRole('article');
}
it('heads the page with the Member Card summary: Nickname, full name, Role, Groups', async () => {
  const user = userEvent.setup();
  view();
  const name = screen.getByRole('button', { name: 'Profilul membrului Ioana' });
  expect(name).toHaveTextContent('IoanaIoana Popescu');
  expect(screen.getByText('Voluntar Activ')).toBeInTheDocument();
  expect(
    within(screen.getByRole('list', { name: 'Grupuri' })).getAllByRole(
      'listitem',
    ),
  ).toHaveLength(2);
  await user.click(name);
  expect(await screen.findByRole('dialog', { name: 'Ioana' })).toBeVisible();
});
it('opening a Member’s history reads the viewer’s Retention Signals about them (#1012)', () => {
  view();
  expect(readNotificationsAbout).toHaveBeenCalledWith([
    `retention_signal:${uid}`,
  ]);
});
it('draws each Assignment with the Task card, read-only, keeping the evaluation record', async () => {
  const user = userEvent.setup();
  const { container } = view();
  expect(state.history).toHaveBeenCalledWith(uid, {});
  const [first, second] = cards() as [HTMLElement, HTMLElement];
  expect(
    within(first).getByRole('heading', { name: 'Pregătește atelierul' }),
  ).toBeInTheDocument();
  expect(first).toHaveTextContent('Echipă · Mentorat');
  expect(first).toHaveTextContent('Campanie: Bun venit');
  // The standing Evaluation is the one the reversal left.
  expect(first).toHaveTextContent(/18 puncte · Dificultate\s+· Nota 5/);
  expect(
    within(first).getAllByRole('img', { name: 'Dificultate 3 din 5' }),
  ).not.toHaveLength(0);
  expect(
    within(first).getByText(/Finalizat ·/, { selector: 'dd' }),
  ).toBeInTheDocument();
  // Read-only: no Executor line, no actions.
  expect(within(first).queryByText('Executor:')).toBeNull();
  expect(within(second).queryByRole('button')).toBeNull();
  expect(second).toHaveTextContent('Activă');
  await user.click(within(first).getByText('Evaluări (2)'));
  expect(
    within(first).getByText(/−1\.234 puncte · Evaluare anulată/),
  ).toBeVisible();
  expect(within(first).getByText(/Corecție/)).toBeVisible();
  // R29a: each Evaluation reads Difficulty as stars and Nota as a number.
  expect(within(first).getAllByText(/· Nota \d/).length).toBeGreaterThan(0);
  await user.click(within(first).getByText('Subtaskuri (1)'));
  expect(within(first).getByText(/Materiale · Finalizat/)).toBeVisible();
  expect(
    (
      await axe.run(container, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
});
it("shows the Task's Attached Link like every other Task view, and none where there is none (#947)", () => {
  state.history.mockReturnValue({
    data: [
      {
        ...workshop,
        links: [
          { label: 'Dosar atelier', url: 'https://drive.example/atelier' },
        ],
      },
      { ...budget, links: [] },
    ],
  });
  view();
  const [first, second] = cards() as [HTMLElement, HTMLElement];
  const link = within(first).getByRole('link', {
    name: 'Dosar atelier (se deschide într-o filă nouă)',
  });
  expect(link).toHaveAttribute('href', 'https://drive.example/atelier');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(within(second).queryByRole('link')).toBeNull();
});
it('narrows by Group subtree and Campaign on the page, and sends the deadline range', async () => {
  const user = userEvent.setup();
  view(uid, '?de_la=2026-09-01&pana_la=2026-09-30');
  const range = {
    p_from: '2026-08-31T21:00:00.000Z',
    p_to: '2026-09-30T21:00:00.000Z',
  };
  expect(state.history).toHaveBeenLastCalledWith(uid, range);
  expect(cards()).toHaveLength(2);
  // Educație covers Mentorat below it, not Financiar.
  await openFilters(user);
  await user.click(screen.getByRole('combobox', { name: 'Grup principal' }));
  await user.click(await screen.findByRole('option', { name: 'Educație' }));
  await closeFilters(user);
  expect(cards()).toHaveLength(1);
  expect(screen.getByText('1 din 2 atribuiri')).toBeInTheDocument();
  // The Group never reaches the server; only the range does.
  expect(state.history).toHaveBeenLastCalledWith(uid, range);
  await user.click(screen.getByRole('button', { name: 'Șterge filtrele' }));
  expect(cards()).toHaveLength(2);
  expect(state.history).toHaveBeenLastCalledWith(uid, {});
});
it('filters by Campaign from the URL and says when nothing matches', () => {
  const { unmount } = view(uid, '?campanie=3');
  expect(cards()).toHaveLength(1);
  unmount();
  state.history.mockReturnValue({ data: [budget] });
  view(uid, '?campanie=3');
  expect(
    screen.getByText(/Nicio atribuire pentru filtrele alese/),
  ).toBeInTheDocument();
});
it('sends nothing while the range is inverted', () => {
  view(uid, '?de_la=2026-09-30&pana_la=2026-09-01');
  expect(state.history).toHaveBeenLastCalledWith(uid, null);
  expect(
    screen.getByText('Corectează perioada din filtre ca să vezi atribuirile.'),
  ).toBeInTheDocument();
});
it('does not query malformed member ids', () => {
  view('not-a-uuid');
  expect(screen.getByRole('heading')).toHaveTextContent('Membru indisponibil');
  expect(state.history).not.toHaveBeenCalled();
});
it('shows an ordinary empty history and a safe retriable error', async () => {
  state.history.mockReturnValue({ data: [] });
  const { unmount } = view();
  expect(screen.getByText(/Nu există atribuiri/)).toBeInTheDocument();
  unmount();
  const retry = vi.fn();
  state.history.mockReturnValue({
    isError: true,
    error: new Error('private SQL'),
    refetch: retry,
  });
  view();
  expect(screen.queryByText('private SQL')).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole('button', { name: 'Reîncarcă istoricul' }),
  );
  expect(retry).toHaveBeenCalled();
});
it('waits for the Group tree before applying a Group level, instead of claiming no match', () => {
  state.options.mockReturnValue({ isPending: true });
  const { unmount } = view(uid, '?grup=7');
  expect(cards()).toHaveLength(0);
  expect(screen.queryByText(/Nicio atribuire/)).toBeNull();
  expect(screen.getAllByText('Se încarcă filtrele…')).toHaveLength(2);
  unmount();
  state.options.mockReturnValue({ isError: true, refetch: vi.fn() });
  view(uid, '?grup=7');
  expect(
    screen.getByText('Filtrul de grup se aplică după ce se încarcă filtrele.'),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Nicio atribuire/)).toBeNull();
});
it('goes back to the Clasament by default, keeping no stray filter', () => {
  view(uid, '?grup=7');
  expect(
    screen.getByRole('link', { name: 'Înapoi la clasament' }),
  ).toHaveAttribute('href', '/clasament');
});
it('goes back exactly where it was opened from, when the link passed state.from (D10)', () => {
  view(uid, '?grup=7&de_la=2026-01-01', {
    from: {
      to: '/clasament?grup=7&de_la=2026-01-01',
      label: 'Înapoi la clasament',
    },
  });
  expect(
    screen.getByRole('link', { name: 'Înapoi la clasament' }),
  ).toHaveAttribute('href', '/clasament?grup=7&de_la=2026-01-01');
});
it('returns to Voluntari when opened from a Member Card there', () => {
  view(uid, '', { from: { to: '/voluntari?rol=3', label: 'Înapoi' } });
  expect(screen.getByRole('link', { name: 'Înapoi' })).toHaveAttribute(
    'href',
    '/voluntari?rol=3',
  );
  expect(
    screen.queryByRole('link', { name: 'Înapoi la clasament' }),
  ).toBeNull();
});
it('lays the Assignment cards on the collection grid, each as tall as its own record (L3)', () => {
  view();
  const grid = screen
    .getByRole('region', { name: 'Atribuiri' })
    .querySelector('[data-slot=page-grid]');
  expect(grid).toHaveAttribute('data-columns', 'collection');
  expect(grid).toHaveClass('md:grid-cols-2', 'xl:grid-cols-3', 'items-start');
  expect(grid).not.toHaveAttribute('data-equal-heights');
  expect(grid?.tagName).toBe('UL');
  expect(within(grid as HTMLElement).getAllByRole('article')).toHaveLength(
    cards().length,
  );
});

function total() {
  return screen.getByRole('region', { name: 'Puncte' });
}
it("heads the page with the Member's total points, read for the whole record (#906)", () => {
  view();
  expect(state.total).toHaveBeenLastCalledWith(uid, {});
  expect(total()).toHaveTextContent('12 puncte');
  expect(total()).toHaveTextContent('din toate taskurile');
  // At the top: the total sits in the Member panel, above the Work Filter.
  const filter = screen.getByRole('button', { name: /^Filtrează/ });
  expect(
    total().compareDocumentPosition(filter) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});
it('re-reads the total with every Work Filter level, as Clasament does (#906)', async () => {
  const user = userEvent.setup();
  view(uid, '?grup=7&subgrup=9&campanie=3&de_la=2026-09-01&pana_la=2026-09-30');
  // Unlike the Assignment list, the total sends the Group and the Campaign:
  // Clasament's figure for this Member under this filter.
  expect(state.total).toHaveBeenLastCalledWith(uid, {
    p_group_id: 9,
    p_campaign_id: 3,
    p_from: '2026-08-31T21:00:00.000Z',
    p_to: '2026-09-30T21:00:00.000Z',
  });
  expect(total()).toHaveTextContent(
    'din filtrele alese · acordate între 1 septembrie 2026 și 30 septembrie 2026',
  );
  state.total.mockReturnValue({ data: 30, isPending: false, isError: false });
  await user.click(screen.getByRole('button', { name: 'Șterge filtrele' }));
  expect(state.total).toHaveBeenLastCalledWith(uid, {});
  expect(total()).toHaveTextContent('30 de puncte');
  expect(total()).toHaveTextContent('din toate taskurile');
});
it('says the range alone when only a period is chosen, and a negative total keeps its sign (#906)', () => {
  state.total.mockReturnValue({ data: -2, isPending: false, isError: false });
  view(uid, '?de_la=2026-09-01');
  expect(total()).toHaveTextContent('−2 puncte');
  expect(total()).toHaveTextContent('acordate din 1 septembrie 2026');
  expect(total()).not.toHaveTextContent('filtrele alese');
});
it('shows 0 points as a figure, a loading line, and a retriable error for the total (#906)', async () => {
  state.total.mockReturnValue({ data: 0, isPending: false, isError: false });
  const first = view();
  expect(total()).toHaveTextContent('0 puncte');
  first.unmount();
  state.total.mockReturnValue({ isPending: true, isError: false });
  const second = view();
  expect(within(total()).getByRole('status')).toHaveTextContent(
    'Se încarcă punctele…',
  );
  second.unmount();
  const retry = vi.fn();
  state.total.mockReturnValue({
    isPending: false,
    isError: true,
    error: new Error('private SQL'),
    refetch: retry,
  });
  view();
  expect(within(total()).getByRole('alert')).toHaveTextContent(
    'Punctele nu s-au încărcat.',
  );
  expect(screen.queryByText('private SQL')).toBeNull();
  await userEvent.click(
    screen.getByRole('button', { name: 'Reîncarcă punctele' }),
  );
  expect(retry).toHaveBeenCalled();
});
it('sends nothing for the total while the range is inverted (#906)', () => {
  view(uid, '?de_la=2026-09-30&pana_la=2026-09-01');
  expect(state.total).toHaveBeenLastCalledWith(uid, null);
  expect(total()).toHaveTextContent('Corectează perioada ca să vezi punctele.');
});

const mentorat = { id: 9, name: 'Mentorat', path: [7, 9], min_level: 0 };
it('offers "Adaugă task finalizat" only to a viewer who may credit the Member somewhere (#915)', () => {
  const hidden = view();
  expect(completed.groups).toHaveBeenCalledWith(uid);
  expect(
    screen.queryByRole('button', { name: 'Adaugă task finalizat' }),
  ).toBeNull();
  hidden.unmount();
  completed.groups.mockReturnValue({
    data: {
      groups: [mentorat],
      groupNames: new Map([
        [7, { name: 'Educație' }],
        [9, { name: 'Mentorat' }],
      ]),
      campaigns: [],
    },
    isPending: false,
    isError: false,
  });
  view();
  expect(
    screen.getByRole('button', { name: 'Adaugă task finalizat' }),
  ).toBeVisible();
});
it('adds a completed Task for the tracked Member, preselected, and says so (#915)', async () => {
  const user = userEvent.setup();
  completed.groups.mockReturnValue({
    data: {
      groups: [mentorat],
      groupNames: new Map([
        [7, { name: 'Educație' }],
        [9, { name: 'Mentorat' }],
      ]),
      campaigns: [],
    },
    isPending: false,
    isError: false,
  });
  completed.create.mockResolvedValue({ id: 77, title: 'Atelier de vară' });
  view();
  await user.click(
    screen.getByRole('button', { name: 'Adaugă task finalizat' }),
  );
  const dialog = await screen.findByRole('dialog', {
    name: 'Adaugă task finalizat',
  });
  // The volunteer is the Member, by Nickname; there is nobody else to pick.
  const member = within(dialog).getByRole('button', {
    name: 'Profilul membrului Ioana',
  });
  expect(member.closest('[data-slot="completed-volunteer"]')).toHaveTextContent(
    /^Voluntar:/,
  );
  expect(
    within(dialog).queryByRole('combobox', { name: /Voluntar/ }),
  ).toBeNull();
  // Their one shared Group is chosen already.
  expect(
    within(dialog).getByRole('combobox', {
      name: 'Grup principal (obligatoriu)',
    }),
  ).toHaveTextContent('Mentorat');
  await user.type(
    within(dialog).getByLabelText('Titlu (obligatoriu)'),
    'Atelier de vară',
  );
  await user.click(within(dialog).getByRole('radio', { name: /^3 stele — / }));
  await user.click(
    within(dialog).getByRole('spinbutton', { name: 'Nota (obligatoriu)' }),
  );
  await user.keyboard('4');
  await user.type(
    within(dialog).getByLabelText('Observații (obligatoriu)'),
    'Foarte bine',
  );
  await user.click(
    within(dialog).getByRole('button', { name: 'Adaugă și acordă punctele' }),
  );
  expect(completed.create).toHaveBeenCalledWith({
    executorId: uid,
    groupId: 9,
    title: 'Atelier de vară',
    description: null,
    links: [],
    campaignId: null,
    difficulty: 3,
    rating: 4,
    note: 'Foarte bine',
  });
  expect(
    await screen.findByText(
      /Taskul finalizat „Atelier de vară” a fost adăugat/,
    ),
  ).toHaveFocus();
  // A long form: slow under the full parallel run.
}, 20_000);
