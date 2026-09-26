import { skipToken, useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import type { RoleHistoryInput } from '../lib/role-timeline';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

export type RoleHistoryRow = RoleHistoryInput;

/**
 * The caller's own `role_history` rows (#633), oldest first.
 *
 * Filtered to `member_id = self` explicitly: the `role_history_read` policy
 * (#50) also lets a level-6 reader see every Member's rows, and the profile
 * page must never show anyone else's history. Status rows (#580) come back
 * too; `buildRoleSegments` drops them, because a Role row is defined by
 * `from_role <> to_role`, not by the Status columns.
 *
 * The default `staleTime`: a Role change is made by someone else (a BC, a
 * Moderator or the promotion job) in another session, so no local mutation
 * invalidates this; refetching on focus and remount is what keeps it current.
 */
export function useMyRoleHistory() {
  const { session } = useAuth();
  const id = session?.user.id;

  return useQuery({
    queryKey: keys.profile.roleHistory(id),
    queryFn: id
      ? async (): Promise<RoleHistoryRow[]> => {
          const { data, error } = await supabase
            .from('role_history')
            .select('from_role, to_role, created_at, actor_kind, changed_by')
            .eq('member_id', id)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true });
          if (error) throw error;
          return data;
        }
      : skipToken,
  });
}
