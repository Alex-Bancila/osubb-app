import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { keys } from './keys';

/**
 * My points total.
 *
 * Read from `member_points` rather than summing `points_ledger` here: the view
 * is the definition of a total, and the client should never be the second place
 * that arithmetic lives (mini-spec §5 — read from a view where one exists).
 */
export function useMyPoints() {
  const { session } = useAuth();
  const id = session?.user.id;

  return useQuery({
    queryKey: keys.points.me(),
    // Nothing to ask for until we know who is asking.
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('member_points')
        .select('points')
        .eq('member_id', id!)
        .maybeSingle();
      if (error) throw error;
      // No ledger rows yet is a real answer for a new member: zero, not null.
      return data?.points ?? 0;
    },
  });
}

/**
 * The leaderboard, ranked, active members only — the view handles both.
 *
 * `rank` comes from the database, so ties tie properly (three members on 15
 * points are all rank 1) instead of the array index pretending otherwise.
 */
export function useLeaderboard(limit = 10) {
  return useQuery({
    queryKey: keys.points.leaderboard(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leaderboard')
        .select('member_id, full_name, role, points, rank')
        .order('rank')
        .limit(limit);
      if (error) throw error;
      return data;
    },
  });
}

/** Cupa Departamentelor: standings by department, highest first. */
export function useDeptCup() {
  return useQuery({
    queryKey: keys.points.deptCup(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('dept_cup')
        .select('dept_id, name, points, members')
        .order('points', { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}
