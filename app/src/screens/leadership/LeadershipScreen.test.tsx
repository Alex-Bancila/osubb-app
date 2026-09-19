import { render, screen } from '@testing-library/react';
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
const uid = '35400000-0000-0000-0000-000000000001';
function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/clasament']}>
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
        points: filters.groupId ? 12 : -1234,
      },
    ],
  }));
  state.cup.mockReturnValue({
    data: [{ group_id: 7, name: 'Educație', points: -1200, members: 8 }],
  });
  state.options.mockReturnValue({
    data: {
      groups: [{ id: 7, name: 'Educație', path: [7], status: 'active' }],
      campaigns: [{ id: 3, name: 'Bun venit', group_id: 7 }],
    },
  });
});
it('changes authoritative filters, displays returned totals and removes chips', async () => {
  const user = userEvent.setup();
  renderPage();
  expect(screen.getByText('−1.234')).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText('Grup'), '7');
  expect(state.board).toHaveBeenLastCalledWith({
    groupId: 7,
    campaignId: undefined,
  });
  expect(screen.getByText('12')).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText('Campanie'), '3');
  expect(state.board).toHaveBeenLastCalledWith({ groupId: 7, campaignId: 3 });
  expect(state.cup).toHaveBeenLastCalledWith(3);
  await user.click(
    screen.getByRole('button', { name: 'Grup: Educație · Elimină' }),
  );
  expect(state.board).toHaveBeenLastCalledWith({
    groupId: undefined,
    campaignId: 3,
  });
});
it('opens member history through an accessible keyboard link and has no axe violations', async () => {
  const user = userEvent.setup();
  const { container } = renderPage();
  expect(
    (
      await axe.run(container, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
  const link = screen.getByRole('link', { name: 'Ioana Popescu' });
  link.focus();
  await user.keyboard('{Enter}');
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
