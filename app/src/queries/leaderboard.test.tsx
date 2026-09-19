import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }));
vi.mock('../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'me' } } }),
}));
import { standingFromBoard, useLeaderboard, useMyStanding } from './points';
const board = [
  { member_id: 'a', full_name: 'Ana', points: 20, rank: 1 },
  { member_id: 'b', full_name: 'Bianca', points: 20, rank: 1 },
  { member_id: 'me', full_name: 'Eu', points: 15, rank: 3 },
];
it('shares one server request between board and standing observers', async () => {
  rpc.mockResolvedValue({ data: board, error: null });
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
