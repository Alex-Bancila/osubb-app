import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import axe from 'axe-core';
const state = vi.hoisted(() => ({
  board: vi.fn(),
  cup: vi.fn(),
  options: vi.fn(),
  access: vi.fn(),
}));
vi.mock('../../queries/leadership', () => ({
  useLeadershipLeaderboard: state.board,
  useLeadershipCup: state.cup,
  useLeadershipFilters: state.options,
}));
vi.mock('../../queries/task-tabs', () => ({ useTaskLeadership: state.access }));
import LeadershipScreen from './LeadershipScreen';
vi.mock(
  '../../queries/member-card',
  () => import('../../test/member-card-mock'),
);
// A leadership viewer: the Member Card carries the tracker link.
vi.mock('../../lib/capabilities', () => ({
  useCapability: (name: string) => ({ data: name === 'seeLeadership' }),
}));
import { useMemberCard } from '../../test/member-card-mock';
const uid = '35400000-0000-0000-0000-000000000001';
function renderPage(query = '') {
  return render(
    <MemoryRouter initialEntries={[`/clasament${query}`]}>
      <main>
        <Routes>
          <Route path="/clasament" element={<LeadershipScreen />} />
          <Route path="/tracker/membru/:id" element={<h1>Istoric membru</h1>} />
          <Route path="/" element={<h1>Acasă</h1>} />
        </Routes>
      </main>
    </MemoryRouter>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  state.access.mockReturnValue({ data: true });
  state.board.mockImplementation((filters) => ({
    data: [
      {
        member_id: uid,
        full_name: 'Ioana Popescu',
        points: filters?.p_group_id ? 12 : -1234,
      },
    ],
  }));
  state.cup.mockReturnValue({
    data: [{ group_id: 7, name: 'Educație', points: -1200, members: 8 }],
  });
  state.options.mockReturnValue({
    data: {
      groups: [
        { id: 7, name: 'Educație', path: [7], status: 'active' },
        { id: 9, name: 'Mentorat', path: [7, 9], status: 'active' },
      ],
      campaigns: [{ id: 3, name: 'Bun venit', group_id: 7 }],
    },
  });
});
it('sends no Work Filter argument with no level set, then the chosen ones', async () => {
  const user = userEvent.setup();
  renderPage();
  expect(state.board).toHaveBeenLastCalledWith({});
  expect(state.cup).toHaveBeenLastCalledWith({});
  expect(screen.getByText('−1.234')).toBeInTheDocument();
  await user.click(screen.getByRole('combobox', { name: 'Grup principal' }));
  await user.click(await screen.findByRole('option', { name: 'Educație' }));
  expect(state.board).toHaveBeenLastCalledWith({ p_group_id: 7 });
  // The Group narrows only the members' board, never the Cup.
  expect(state.cup).toHaveBeenLastCalledWith({});
  expect(screen.getByText('12')).toBeInTheDocument();
  await user.click(screen.getByRole('combobox', { name: 'Campanie' }));
  await user.click(await screen.findByRole('option', { name: /^Bun venit/ }));
  expect(state.board).toHaveBeenLastCalledWith({
    p_group_id: 7,
    p_campaign_id: 3,
  });
  expect(state.cup).toHaveBeenLastCalledWith({ p_campaign_id: 3 });
  await user.click(
    screen.getByRole('button', {
      name: 'Elimină filtrul Grup principal: Educație',
    }),
  );
  // Removing the root removes the Campaign that depended on it.
  expect(state.board).toHaveBeenLastCalledWith({});
});
it('restores all four levels from the URL and sends the midnight bounds', () => {
  renderPage(
    '?grup=7&subgrup=9&campanie=3&de_la=2026-09-01&pana_la=2026-09-30',
  );
  expect(state.board).toHaveBeenLastCalledWith({
    p_group_id: 9,
    p_campaign_id: 3,
    p_from: '2026-08-31T21:00:00.000Z',
    p_to: '2026-09-30T21:00:00.000Z',
  });
  expect(state.cup).toHaveBeenLastCalledWith({
    p_campaign_id: 3,
    p_from: '2026-08-31T21:00:00.000Z',
    p_to: '2026-09-30T21:00:00.000Z',
  });
  expect(
    screen.getByRole('combobox', { name: 'Grup principal' }),
  ).toHaveTextContent('Educație');
  expect(screen.getByRole('combobox', { name: 'Subgrup' })).toHaveTextContent(
    'Mentorat',
  );
  expect(screen.getByRole('combobox', { name: 'Campanie' })).toHaveTextContent(
    'Bun venit',
  );
});
it('sends nothing while Până la is before De la', () => {
  renderPage('?de_la=2026-09-30&pana_la=2026-09-01');
  expect(state.board).toHaveBeenLastCalledWith(null);
  expect(state.cup).toHaveBeenLastCalledWith(null);
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Data de sfârșit nu poate fi înaintea celei de început.',
  );
  expect(
    screen.getAllByText(
      'Corectează perioada din filtre ca să vezi rezultatele.',
    ),
  ).toHaveLength(2);
});
it('names each Member by Nickname as a card button whose card links to their history, with no axe violations', async () => {
  const user = userEvent.setup();
  state.board.mockReturnValue({
    data: [
      {
        member_id: uid,
        full_name: 'Ioana Popescu',
        nickname: 'Ioana',
        points: 30,
        rank: 1,
      },
    ],
  });
  useMemberCard.mockReturnValue({
    data: {
      memberId: uid,
      nickname: 'Ioana',
      fullName: 'Ioana Popescu',
      roleLabel: null,
      joinedAt: null,
      avatarColor: null,
      primaryGroup: null,
      otherMemberships: 0,
      groups: [],
      contact: null,
    },
    isPending: false,
    isError: false,
    refetch: async () => {},
  } as never);
  const { container } = renderPage();
  expect(
    (
      await axe.run(container, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
  const name = screen.getByRole('button', { name: 'Profilul membrului Ioana' });
  name.focus();
  await user.keyboard('{Enter}');
  const card = await screen.findByRole('dialog', { name: 'Ioana' });
  // Clicking inside the card is not a click on the row behind it.
  await user.click(within(card).getByText('Ioana Popescu'));
  expect(screen.queryByRole('heading', { name: 'Istoric membru' })).toBeNull();
  await user.click(
    within(card).getByRole('link', { name: 'Vezi istoricul taskurilor' }),
  );
  expect(
    screen.getByRole('heading', { name: 'Istoric membru' }),
  ).toBeInTheDocument();
});
it('keeps Cup independent when board fails and offers retry', async () => {
  const retry = vi.fn();
  state.board.mockReturnValue({ isError: true, refetch: retry });
  renderPage();
  expect(screen.getByText('−1.200')).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole('button', { name: 'Reîncarcă clasamentul' }),
  );
  expect(retry).toHaveBeenCalled();
});
it('shows loading and empty states without inventing totals', () => {
  state.board.mockReturnValue({ isPending: true });
  state.cup.mockReturnValue({ data: [] });
  renderPage();
  expect(screen.getByRole('status')).toHaveTextContent(
    'Se încarcă clasamentul',
  );
  expect(
    screen.getByText('Nu există grupuri înscrise în Cupă.'),
  ).toBeInTheDocument();
});
it('mounts no metric queries when the live leadership gate denies stale claims', () => {
  state.access.mockReturnValue({ data: false });
  renderPage();
  expect(screen.getByRole('heading', { name: 'Acasă' })).toBeInTheDocument();
  expect(state.board).not.toHaveBeenCalled();
  expect(state.cup).not.toHaveBeenCalled();
});

it('opens the same member from the non-link portion of a row', async () => {
  renderPage();
  await userEvent.click(screen.getByText('−1.234'));
  expect(
    screen.getByRole('heading', { name: 'Istoric membru' }),
  ).toBeInTheDocument();
});

it('handles empty leaderboard, filter failure and Cup retry independently', async () => {
  const filtersRetry = vi.fn();
  const cupRetry = vi.fn();
  state.options.mockReturnValue({ isError: true, refetch: filtersRetry });
  state.board.mockReturnValue({ data: [] });
  state.cup.mockReturnValue({ isError: true, refetch: cupRetry });
  renderPage();
  expect(
    screen.getByText('Nu există puncte pentru filtrele alese'),
  ).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole('button', { name: 'Reîncarcă filtrele' }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Reîncarcă Cupa' }));
  expect(filtersRetry).toHaveBeenCalled();
  expect(cupRetry).toHaveBeenCalled();
});
it('does not mount protected reads while live access is loading or failed', async () => {
  state.access.mockReturnValue({ isPending: true });
  const { unmount } = renderPage();
  expect(screen.getByRole('status')).toHaveTextContent('Se verifică accesul');
  expect(state.board).not.toHaveBeenCalled();
  unmount();
  const retry = vi.fn();
  state.access.mockReturnValue({ isError: true, refetch: retry });
  renderPage();
  await userEvent.click(
    screen.getByRole('button', { name: 'Încearcă din nou' }),
  );
  expect(retry).toHaveBeenCalled();
  expect(state.board).not.toHaveBeenCalled();
});

// The searchable Group Combobox's own "search by name or parent" behaviour
// is pinned once, on the shared component itself
// (components/group/GroupFilterCombobox.test.tsx, #646) -- this file only
// needs to prove the selection reaches the leaderboard's filters, which the
// first test in this file ("changes authoritative filters...") already does.
