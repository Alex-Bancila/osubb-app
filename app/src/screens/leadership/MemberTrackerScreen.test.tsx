import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import axe from 'axe-core';
const state = vi.hoisted(() => ({ history: vi.fn(), options: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../queries/leadership', () => ({
  useLeadershipMemberTasks: state.history,
  useLeadershipFilters: state.options,
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
import { useMemberCard } from '../../test/member-card-mock';
const uid = '35400000-0000-0000-0000-000000000001';
function view(id = uid, query = '') {
  return render(
    <MemoryRouter initialEntries={[`/tracker/membru/${id}${query}`]}>
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
  state.history.mockReturnValue({ data: [workshop, budget] });
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
  expect(first).toHaveTextContent('18 puncte · Dificultate 3 · Nota 5');
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
  await user.click(screen.getByRole('combobox', { name: 'Grup principal' }));
  await user.click(await screen.findByRole('option', { name: 'Educație' }));
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
