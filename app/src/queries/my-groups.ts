import type { Database } from '../lib/database.types';
import { skipToken, useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

/**
 * One row of `public.my_groups()` (#576): a Group where the live caller holds an
 * effective Group Role — their own roster row, Automatic Membership, or a
 * Manager/Responsible position inherited from an ancestor.
 */
export type MyGroup =
  Database['public']['Functions']['my_groups']['Returns'][number];

/**
 * The caller's Groups, read live. Not the `group_ids` claim: that is stamped at
 * token issue, so a Member appointed into a Group after signing in would not
 * see it for up to an hour (ruling R29).
 */
export async function fetchMyGroups(): Promise<MyGroup[]> {
  const { data, error } = await supabase.rpc('my_groups');
  if (error) throw error;
  return data ?? [];
}

/** Live effective Group Roles, shared by screens outside Administrare. */
export function useMyGroupRoles() {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.groups.mine(memberId),
    queryFn: memberId ? fetchMyGroups : skipToken,
  });
}

/**
 * Membership, as opposed to authority (ruling R31): the caller's own roster row
 * on this Group, or Automatic Membership of it. A Group reached only through a
 * managed ancestor is not one the caller is a member of — a Department member
 * is not a member of its Child Team (Wave 2 ruling D2).
 */
export function isMemberOf(group: MyGroup): boolean {
  return group.explicit || group.automatic;
}

/** The ids of the Groups the caller is a member of (see `isMemberOf`). */
export function memberGroupIds(groups: readonly MyGroup[]): Set<number> {
  return new Set(groups.filter(isMemberOf).map((group) => group.id));
}
