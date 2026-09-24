import { skipToken, useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

export type RoleHistoryRow = {
  from_role: Database['public']['Enums']['member_role'];
  to_role: Database['public']['Enums']['member_role'];
  created_at: string;
};

/**
 * The caller's own Role-change history, oldest first.
 *
 * The `role_history` table also records Status changes (from_role = to_role,
 * from_status ≠ to_status) since #580. We filter to Role changes only by
 * selecting rows where `from_status` is null — per the `role_history_change_ck`
 * constraint, a Role row always has both Status columns null.
 *
 * RLS (#50) allows `member_id = auth.uid()` for every active member.
 * `staleTime: Infinity` because a Role change goes through `set_member_role`
 * which triggers a full profile invalidation (`keys.profile.all`).
 */
export function useMyRoleHistory() {
  const { session } = useAuth();
  const id = session?.user.id;

  return useQuery({
    queryKey: keys.profile.roleHistory(id),
    staleTime: Infinity,
    queryFn: id
      ? async (): Promise<RoleHistoryRow[]> => {
          const { data, error } = await supabase
            .from('role_history')
            .select('from_role, to_role, created_at')
            .eq('member_id', id)
            .is('from_status', null)
            .order('created_at', { ascending: true });
          if (error) throw error;
          return data as RoleHistoryRow[];
        }
      : skipToken,
  });
}
