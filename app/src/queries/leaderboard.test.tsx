import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }));
vi.mock('../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'me' } } }),
}));
import {
  fetchLeaderboard,
  standingFromBoard,
  useLeaderboard,
  useMyStanding,
} from './points';
const range = vi.fn();
const order = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  order.mockReturnValue({ order, range });
  rpc.mockReturnValue({ order });
});
const board = [
  { member_id: 'a', full_name: 'Ana', points: 20, rank: 1 },
  { member_id: 'b', full_name: 'Bianca', points: 20, rank: 1 },
  { member_id: 'me', full_name: 'Eu', points: 15, rank: 3 },
];
it('shares one server request between board and standing observers', async () => {
  range.mockResolvedValue({ data: board, error: null });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60000 } },
  });
  const { result } = renderHook(
    () => ({ board: useLeaderboard(2), standing: useMyStanding() }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
  await waitFor(() => expect(result.current.standing.isSuccess).toBe(true));
  expect(rpc).toHaveBeenCalledExactlyOnceWith('leadership_leaderboard');
  expect(result.current.board.data).toHaveLength(2);
  expect(result.current.standing.data).toMatchObject({
    rank: 3,
    total: 3,
    next: { rank: 1, gap: 5 },
    mine: board[2],
  });
});
it('preserves ties and handles absent members', () => {
  expect(standingFromBoard(board, 'a').next).toBeNull();
  expect(standingFromBoard(board, 'absent')).toEqual({
    rank: null,
    total: 3,
    mine: null,
    next: null,
  });
});

it('loads the full board beyond the server row cap with deterministic pages', async () => {
  const rows = Array.from({ length: 1001 }, (_, index) => ({
    member_id: `member-${index}`,
    full_name: `Member ${index}`,
    points: 2000 - index,
    rank: index + 1,
  }));
  range.mockImplementation((from: number, to: number) =>
    Promise.resolve({
      data: rows.slice(from, to + 1),
      error: null,
    }),
  );
  const complete = await fetchLeaderboard();
  expect(complete).toHaveLength(1001);
  expect(standingFromBoard(complete, 'member-1000')).toMatchObject({
    rank: 1001,
    total: 1001,
    next: { rank: 1000, gap: 1 },
  });
  expect(range.mock.calls).toEqual([
    [0, 499],
    [500, 999],
    [1000, 1499],
  ]);
  expect(order).toHaveBeenCalledWith('rank');
  expect(order).toHaveBeenCalledWith('full_name');
  expect(order).toHaveBeenCalledWith('member_id');
});
it('rejects a failed later page instead of displaying a partial ranking', async () => {
  const error = { message: 'network unavailable' };
  range
    .mockResolvedValueOnce({
      data: Array.from({ length: 500 }, () => board[0]),
      error: null,
    })
    .mockResolvedValueOnce({ data: null, error });
  await expect(fetchLeaderboard()).rejects.toEqual(error);
});
