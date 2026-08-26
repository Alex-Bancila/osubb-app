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
 * Where I stand: my rank, out of how many, and what closes the gap.
 *
 * Three round trips rather than one, because the answer genuinely is three
 * questions and PostgREST cannot join them without an RPC:
 *
 *  - my row on the board — the top-10 the dashboard also shows is no help here,
 *    since rank 11 is exactly the member who most wants to know;
 *  - how many members the board has, so "#4" can say "of 8";
 *  - the member directly above me, which is what makes the number actionable.
 *
 * The gap is `their points − mine`, with no `+ 1`: `rank()` gives ties the same
 * rank, so drawing level with them really does take their place.
 *
 * A member absent from the board (`status <> 'activ'`) has no rank, and this
 * returns `null` for it rather than inventing one.
 */
export function useMyStanding() {
  const { session } = useAuth();
  const id = session?.user.id;

  return useQuery({
    queryKey: keys.points.standing(),
    enabled: Boolean(id),
    queryFn: async () => {
      const mine = await supabase
        .from('leaderboard')
        .select('rank, points')
        .eq('member_id', id!)
        .maybeSingle();
      if (mine.error) throw mine.error;

      const total = await supabase
        .from('leaderboard')
        .select('member_id', { count: 'exact', head: true });
      if (total.error) throw total.error;

      if (!mine.data?.rank) {
        return { rank: null, total: total.count ?? 0, next: null };
      }

      const above = await supabase
        .from('leaderboard')
        .select('rank, points')
        .gt('points', mine.data.points ?? 0)
        .order('points', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (above.error) throw above.error;

      return {
        rank: mine.data.rank,
        total: total.count ?? 0,
        next: above.data
          ? {
              rank: above.data.rank!,
              gap: (above.data.points ?? 0) - (mine.data.points ?? 0),
            }
          : null,
      };
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
