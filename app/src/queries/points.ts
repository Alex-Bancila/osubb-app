import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { keys } from './keys';

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
