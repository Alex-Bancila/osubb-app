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
  // R58: the Points Start Date, null until BC sets one.
  pointsStart: null as string | null | undefined,
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
vi.mock('../../queries/evaluation-settings', () => ({
  usePointsStartDate: () => state.pointsStart,
}));
import MemberTrackerScreen from './MemberTrackerScreen';
import { memberTaskPresentation } from './member-history';
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
  createMany: vi.fn(),
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
  useCreateCompletedTasks: () => ({
    mutateAsync: completed.createMany,
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
  state.pointsStart = null;
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
it('heads the page with the Member, as Profil does: the name as the h1, then one meta line', async () => {
  const user = userEvent.setup();
  const { container } = view();
  // The page is about the Member: their name is the title, and the page's
  // own name is kept in it for a screen reader.
  const title = screen.getByRole('heading', { level: 1 });
  expect(title).toHaveAccessibleName('Trackerul membrului: Ioana');
  expect(within(title).getByText('Trackerul membrului:')).toHaveClass(
    'sr-only',
  );
  expect(title).toHaveTextContent(/Ioana$/);
  const identity = container.querySelector(
    '[data-slot="member-identity"]',
  ) as HTMLElement;
  expect(identity).toContainElement(title);
  // No summary card under the header any more.
  expect(screen.queryByRole('region', { name: 'Membru' })).toBeNull();
  const meta = identity.querySelector(
    '[data-slot="member-meta"]',
  ) as HTMLElement;
  expect(within(meta).getByText('Voluntar Activ')).toHaveClass('role-badge');
  expect(within(meta).getByText('Ioana Popescu')).toBeVisible();
  expect(meta).toContainElement(total());
  expect(
    within(within(meta).getByRole('list', { name: 'Grupuri' })).getAllByRole(
      'listitem',
    ),
  ).toHaveLength(2);
  // The avatar opens the Member Card.
  const avatar = within(identity).getByRole('button', {
    name: 'Profilul membrului Ioana',
  });
  await user.click(avatar);
  expect(await screen.findByRole('dialog', { name: 'Ioana' })).toBeVisible();
});
it('names two Groups on the meta line and counts the rest, on one row', () => {
  // The Member this file's `beforeEach` answers with, in two more Groups.
  const { data } = useMemberCard() as unknown as {
    data: { groups: object[] };
  };
  useMemberCard.mockReturnValue({
    data: {
      ...data,
      groups: [
        ...data.groups,
        { id: 11, name: 'Financiar', label: 'Financiar', color: '#007F33' },
        { id: 12, name: 'Bal', label: 'Balul Bobocilor', color: null },
      ],
    },
    isPending: false,
    isError: false,
    refetch: async () => {},
  } as never);
  view();
  const groups = screen.getByRole('list', { name: 'Grupuri' });
  expect(groups).not.toHaveClass('flex-wrap');
  const items = within(groups).getAllByRole('listitem');
  expect(items.map((item) => item.textContent)).toEqual([
    'Educație',
    'Mentorat · Educație',
    '+2și încă 2 grupuri',
  ]);
  expect(within(groups).getByText('și încă 2 grupuri')).toHaveClass('sr-only');
});
it('says the page and that the profile is unavailable when the Member Card has no answer', () => {
  useMemberCard.mockReturnValue({
    data: undefined,
    isPending: false,
    isError: true,
    refetch: async () => {},
  } as never);
  view();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    /^Trackerul membrului$/,
  );
  expect(screen.getByText('Profilul nu este disponibil.')).toBeVisible();
  expect(screen.queryByRole('region', { name: 'Puncte' })).toBeNull();
  // The record is still listed.
  expect(cards()).toHaveLength(2);
});
it('opening a Member’s history reads the viewer’s Retention Signals about them (#1012)', () => {
  view();
  expect(readNotificationsAbout).toHaveBeenCalledWith([
    `retention_signal:${uid}`,
  ]);
});
it('draws each Assignment with the Task row, read-only, keeping the evaluation record', async () => {
  const user = userEvent.setup();
  const { container } = view();
  expect(state.history).toHaveBeenCalledWith(uid, {});
  const [first, second] = cards() as [HTMLElement, HTMLElement];
  expect(
    within(first).getByRole('heading', { name: 'Pregătește atelierul' }),
  ).toBeInTheDocument();
  expect(first).toHaveTextContent('Echipă · Mentorat');
  // The row names the Group by its chip; the Campaign is the filter's.
  expect(first).toHaveAttribute('data-slot', 'task-row');
  expect(first).not.toHaveTextContent('Campanie: Bun venit');
  // The standing Evaluation is the one the reversal left.
  expect(first).toHaveTextContent(/18 puncte.*Nota 5/);
  expect(
    within(first).getAllByRole('img', { name: 'Dificultate 3 din 5' }),
  ).not.toHaveLength(0);
  expect(
    within(first).getByText(/Finalizat ·/, { selector: 'dd' }),
  ).toBeInTheDocument();
  // Short dates in the record; the year only once 2026 is not this year.
  expect(
    within(first).getByText('Atribuit').nextElementSibling,
  ).toHaveTextContent(/^joi, 10 sept\.( 2026)?$/);
  expect(first).not.toHaveTextContent(/septembrie/);
  // One heading for the page, one for the list: no eyebrow repeats either.
  expect(container.querySelector('[data-slot="page-eyebrow"]')).toBeNull();
  expect(container.querySelector('[data-slot="section-eyebrow"]')).toBeNull();
  expect(
    screen.getByRole('heading', { level: 2, name: 'Atribuiri' }),
  ).toBeVisible();
  expect(
    container.querySelectorAll('[data-slot="section-header"]'),
  ).toHaveLength(1);
  // The count sits on the heading's row; the list starts right under it.
  const heading = screen
    .getByRole('heading', { name: 'Atribuiri' })
    .closest('[data-slot="section-header"]') as HTMLElement;
  expect(within(heading).getByText('2 atribuiri')).toBeVisible();
  expect(heading.querySelector('p')).toBeNull();
  // Read-only: no Executor line, no actions.
  expect(within(first).queryByText('Executor:')).toBeNull();
  expect(within(second).queryByRole('button')).toBeNull();
  expect(second).toHaveTextContent('Activă');
  // The shared disclosure (a chevron that turns), not a bare <details>.
  const evaluations = within(first)
    .getByText('Evaluări (2)')
    .closest('details') as HTMLDetailsElement;
  expect(evaluations).toHaveAttribute('data-slot', 'disclosure');
  expect(evaluations.querySelector('summary svg')).not.toBeNull();
  expect(evaluations.open).toBe(false);
  await user.click(within(first).getByText('Evaluări (2)'));
  expect(evaluations.open).toBe(true);
  expect(
    within(first).getByText(/−1\.234 puncte · Evaluare anulată/),
  ).toBeVisible();
  expect(within(first).getByText(/Corecție/)).toBeVisible();
  // R29a: each Evaluation reads Difficulty as stars and Nota as a number.
  expect(within(first).getAllByText(/· Nota \d/).length).toBeGreaterThan(0);
  expect(
    within(first).getByText('Subtaskuri (1)').closest('details'),
  ).toHaveAttribute('data-slot', 'disclosure');
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
it('lists the Assignments as one column of Task rows, each closing on its own record', () => {
  view();
  const region = screen.getByRole('region', { name: 'Atribuiri' });
  expect(region.querySelector('[data-slot=page-grid]')).toBeNull();
  const list = region.querySelector('[data-slot=task-row-list]');
  expect(list?.tagName).toBe('UL');
  expect(list).toHaveClass('grid', 'gap-2', 'min-w-0');
  expect(list?.className).not.toMatch(/grid-cols-/);
  const rows = within(list as HTMLElement).getAllByRole('article');
  expect(rows).toHaveLength(cards().length);
  for (const row of rows) {
    expect(row).toHaveAttribute('data-slot', 'task-row');
    // Read-only: no id for a deep link, nothing to open, its record inside.
    expect(row).not.toHaveAttribute('id');
    expect(row.querySelector('[data-slot=task-row-open]')).toBeNull();
    expect(row.querySelector('[data-slot=task-row-history]')).toHaveTextContent(
      'Atribuit',
    );
  }
});

function total() {
  return screen.getByRole('region', { name: 'Puncte' });
}
/** The scope sentence beside the figure. */
function scope() {
  return total().querySelector(
    '[data-slot="member-total-scope"]',
  ) as HTMLElement;
}
it("heads the page with the Member's total points, read for the whole record (#906)", () => {
  view();
  expect(state.total).toHaveBeenLastCalledWith(uid, {});
  // "12 pct" to the eye, the whole noun to a screen reader.
  expect(total()).toHaveTextContent(/^12 pctpuncte din toate taskurile$/);
  expect(within(total()).getByText('pct')).toHaveAttribute(
    'aria-hidden',
    'true',
  );
  expect(within(total()).getByText('puncte')).toHaveClass('sr-only');
  // The figure alone says "everything"; the sentence is for a screen reader.
  expect(scope()).toHaveClass('sr-only');
});
it('draws Filtrează as an icon on the name’s row, not on a row of its own', () => {
  const { container } = view();
  const filter = screen.getByRole('button', { name: /^Filtrează/ });
  expect(
    container.querySelector('[data-slot="member-actions"]'),
  ).toContainElement(filter);
  // The header's compact button: the icon alone on a phone.
  expect(within(filter).getByText('Filtrează')).toHaveClass('max-sm:sr-only');
  expect(filter.querySelector('svg')).not.toBeNull();
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
  // Narrowed: the sentence is on the page, for everyone.
  expect(scope()).not.toHaveClass('sr-only');
  state.total.mockReturnValue({ data: 30, isPending: false, isError: false });
  await user.click(screen.getByRole('button', { name: 'Șterge filtrele' }));
  expect(state.total).toHaveBeenLastCalledWith(uid, {});
  expect(total()).toHaveTextContent('30 pctde puncte');
  expect(total()).toHaveTextContent('din toate taskurile');
});
it('says the range alone when only a period is chosen, and a negative total keeps its sign (#906)', () => {
  state.total.mockReturnValue({ data: -2, isPending: false, isError: false });
  view(uid, '?de_la=2026-09-01');
  expect(total()).toHaveTextContent('−2 pctpuncte');
  expect(total()).toHaveTextContent('acordate din 1 septembrie 2026');
  expect(total()).not.toHaveTextContent('filtrele alese');
});
it('says the total counts from the Points Start Date when nothing narrows it (R58)', () => {
  state.pointsStart = '2026-09-01';
  view();
  // The filter is not prefilled: the server floors, the caption says so.
  expect(state.total).toHaveBeenLastCalledWith(uid, {});
  expect(total()).toHaveTextContent(/^12 pctpuncte acordate din 01\.09\.2026$/);
  // A real sentence now, not the redundant "everything".
  expect(scope()).not.toHaveClass('sr-only');
  expect(total()).not.toHaveTextContent('din toate taskurile');
});
it('keeps the whole-record sentence while no Points Start Date is set (R58)', () => {
  view();
  expect(total()).toHaveTextContent('din toate taskurile');
  expect(scope()).toHaveClass('sr-only');
});
it('claims nothing about the period while the Points Start Date is not known yet (R58)', () => {
  state.pointsStart = undefined;
  const first = view();
  // Not "din toate taskurile" either: the date may floor the total.
  expect(total()).toHaveTextContent(/^12 pctpuncte$/);
  expect(scope().textContent).toBe('');
  first.unmount();
  view(uid, '?grup=7');
  expect(total()).toHaveTextContent(/^12 pctpuncte din filtrele alese$/);
  expect(total()).not.toHaveTextContent('acordate');
});
it('joins the start to the filters chosen, and to a range that has only an end (R58)', () => {
  state.pointsStart = '2026-09-01';
  view(uid, '?grup=7&pana_la=2026-09-30');
  expect(total()).toHaveTextContent(
    'din filtrele alese · acordate din 01.09.2026 până la 30 septembrie 2026',
  );
});
it('reads an explicit De la earlier than the start as the range it is, the lookback (R58)', () => {
  state.pointsStart = '2026-09-01';
  view(uid, '?de_la=2026-08-01');
  expect(total()).toHaveTextContent('acordate din 1 august 2026');
  expect(total()).not.toHaveTextContent('01.09.2026');
});
it('shows 0 points as a figure, a loading line, and a retriable error for the total (#906)', async () => {
  state.total.mockReturnValue({ data: 0, isPending: false, isError: false });
  const first = view();
  expect(total()).toHaveTextContent('0 pctpuncte');
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
  // The page's plus button, named by the action; no labelled button.
  const add = screen.getByRole('button', { name: 'Adaugă task finalizat' });
  expect(add).toBeVisible();
  expect(add).toHaveAttribute('data-slot', 'fab');
  expect(add).not.toHaveTextContent('Adaugă task finalizat');
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
  completed.createMany.mockResolvedValue([
    { id: 77, title: 'Atelier de vară' },
  ]);
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
    within(dialog).getByRole('combobox', { name: 'Grup principal' }),
  ).toHaveTextContent('Mentorat');
  await user.type(
    within(dialog).getByLabelText(/^Titlu( \(obligatoriu\))?$/),
    'Atelier de vară',
  );
  await user.click(within(dialog).getByRole('radio', { name: /^3 stele — / }));
  await user.click(
    within(dialog).getByRole('spinbutton', {
      name: /^Nota( \(obligatoriu\))?$/,
    }),
  );
  await user.keyboard('4');
  await user.type(
    within(dialog).getByLabelText(/^Observații( \(obligatoriu\))?$/),
    'Foarte bine',
  );
  await user.click(
    within(dialog).getByRole('button', { name: 'Adaugă și acordă punctele' }),
  );
  expect(completed.createMany).toHaveBeenCalledWith({
    draft: {
      executorId: uid,
      groupId: 9,
      title: 'Atelier de vară',
      description: null,
      links: [],
      campaignId: null,
      difficulty: 3,
      rating: 4,
      note: 'Foarte bine',
      copies: 1,
    },
  });
  expect(
    await screen.findByText(
      /Taskul finalizat „Atelier de vară” a fost adăugat/,
    ),
  ).toHaveFocus();
  // A long form: slow under the full parallel run.
}, 20_000);

it('carries a Task’s Cine îl vede into the drill-down’s rows (R57)', () => {
  const presented = memberTaskPresentation(
    // The screen's fixtures carry only the columns it shows.
    {
      ...workshop,
      assignment_mode: 'public',
      audience: 'org',
      min_level: 1,
    } as unknown as Parameters<typeof memberTaskPresentation>[0],
    new Map(),
    new Date('2026-10-15T12:00:00Z'),
  );
  expect(presented.minLevelLabel).toBe('De la Voluntar');
});
