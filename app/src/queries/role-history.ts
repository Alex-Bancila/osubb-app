import { skipToken, useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import type { RoleHistoryInput } from '../lib/role-timeline';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

export type RoleHistoryRow = RoleHistoryInput;

/** One Member's `role_history` rows, oldest first. */
async function fetchRoleHistory(memberId: string): Promise<RoleHistoryRow[]> {
  const { data, error } = await supabase
    .from('role_history')
    .select('from_role, to_role, created_at, actor_kind, changed_by')
    .eq('member_id', memberId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;
  return data;
}

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
    queryFn: id ? () => fetchRoleHistory(id) : skipToken,
  });
}

/**
 * Another Member's `role_history` rows, for their Administrare page (#932).
 * `role_history_read` answers them to a level-6 reader only, so the page
 * mounts its reader for BC and the Moderator alone. Under `members`, keyed by viewer:
 * a Role change from the page's Role panel invalidates `members` and so
 * refreshes this too.
 */
export function useMemberRoleHistory(memberId: string) {
  const viewerId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.members.roleHistory(memberId, viewerId),
    queryFn: viewerId ? () => fetchRoleHistory(memberId) : skipToken,
  });
}
