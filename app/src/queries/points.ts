import { skipToken, useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { keys } from './keys';
import type { Database } from '../lib/database.types';

/**
 * My points total.
 *
 * Read from the self-scoped `my_points` view rather than summing
 * `points_ledger` here. The database derives the identity from auth.uid(), so
 * this query never accepts a member id that a client could forge.
 */
export function useMyPoints(options?: { enabled?: boolean }) {
  const { session } = useAuth();
  const id = session?.user.id;

  return useQuery({
    queryKey: keys.points.me(id),
    // Nothing to ask for until we know who is asking.
    enabled: Boolean(id) && (options?.enabled ?? true),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('my_points')
        .select('points')
        .maybeSingle();
      if (error) throw error;
      // No ledger rows yet is a real answer for a new member: zero, not null.
      return data?.points ?? 0;
    },
  });
}

type Board =
  Database['public']['Functions']['leadership_leaderboard']['Returns'];
const BOARD_PAGE_SIZE = 500;

/** One shared, complete RLS-protected board feeds every ranking projection. */
export async function fetchLeaderboard(): Promise<Board> {
  const board: Board = [];
  for (let from = 0; ; from += BOARD_PAGE_SIZE) {
    const { data, error } = await supabase
      .rpc('leadership_leaderboard')
      .order('rank')
      .order('full_name')
      .order('member_id')
      .range(from, from + BOARD_PAGE_SIZE - 1);
    if (error) throw error;
    board.push(...data);
    if (data.length < BOARD_PAGE_SIZE) return board;
  }
}

export function standingFromBoard(board: Board, memberId: string) {
  const mine = board.find((row) => row.member_id === memberId) ?? null;
  const above = mine
    ? [...board].reverse().find((row) => row.points > mine.points)
    : null;
  return {
    rank: mine?.rank ?? null,
    total: board.length,
    mine,
    next:
      above && mine
        ? { rank: above.rank, gap: above.points - mine.points }
        : null,
  };
}

export function useMyStanding({ enabled = true }: { enabled?: boolean } = {}) {
  const id = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.points.board(id),
    queryFn: id && enabled ? fetchLeaderboard : skipToken,
    select: (board) => standingFromBoard(board, id ?? ''),
  });
}

export function useLeaderboard(limit = 10) {
  const id = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.points.board(id),
    queryFn: id ? fetchLeaderboard : skipToken,
    select: (board) => board.slice(0, limit),
  });
}

/** Cupa Departamentelor: standings by department, highest first. */
export function useDeptCup() {
  return useQuery({
    queryKey: keys.points.deptCup(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('dept_cup')
        .select('group_id, name, points, members')
        .order('points', { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}
