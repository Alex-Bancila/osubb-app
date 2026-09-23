import { skipToken, useQuery } from '@tanstack/react-query';
import { keys } from '../queries/keys';
import { useAuth, type MemberClaims } from './auth';
import { supabase } from './supabase';

/**
 * What the signed-in member may do, as the server computes it from their live
 * rank and live Group Roles (`public.my_capabilities()`, ADR-0009 Decision 6).
 *
 * ⚠️ Nothing here is a security control. Every command and every policy
 * decides again on the server; these exist so the UI can be *kind*: hide a tab
 * nobody can use, skip a query that would only come back empty. There is no
 * level map in the client any more — a Group Role is not in the token, and a
 * threshold copied here is one that drifts from the database.
 */
export type Capabilities = {
  /** Holds a Group Manager or Responsible position anywhere, or is BC+. */
  managesAnyGroup: boolean;
  /** Exactly `public.can_manage_tasks()`: manages work in some Group. */
  manageTasks: boolean;
  /** Rank BCE+ (the `profiles_contact` gate the volunteer directory needs). */
  seeDirectory: boolean;
  /** Rank BCE+ (leaderboard, Department Cup, member history). */
  seeLeadership: boolean;
  manageRoles: boolean;
  provisionMembers: boolean;
  createTopLevelGroups: boolean;
  /** Opens Administrare: a Group Role anywhere, or BC+. */
  administer: boolean;
};

export type Capability = keyof Capabilities;

export async function fetchCapabilities(): Promise<Capabilities> {
  const { data, error } = await supabase.rpc('my_capabilities').single();
  if (error) throw error;
  return {
    managesAnyGroup: data.manages_any_group,
    manageTasks: data.manage_tasks,
    seeDirectory: data.see_directory,
    seeLeadership: data.see_leadership,
    manageRoles: data.manage_roles,
    provisionMembers: data.provision_members,
    createTopLevelGroups: data.create_top_level_groups,
    administer: data.administer,
  };
}

/**
 * One request per session: rank and Group Roles change rarely, so the row is
 * never stale on a timer, but it is re-read whenever the window regains focus
 * — the moment a member returns after BC changed something. Pass `select` to
 * read one capability from the same cache entry without a second round-trip.
 */
export function useCapabilities<T = Capabilities>(
  select?: (capabilities: Capabilities) => T,
) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.capabilities(memberId),
    queryFn: memberId ? fetchCapabilities : skipToken,
    staleTime: Infinity,
    refetchOnWindowFocus: 'always',
    select,
  });
}

/** `useCapability('manageRoles').data === true` — one capability, same query. */
export function useCapability(capability: Capability) {
  return useCapabilities((capabilities) => capabilities[capability]);
}

/**
 * True for a Member who still files Completed-work Requests for their own
 * work — below level 5 (ruling R14 of the 2026-09-21 profile page grill,
 * corrected 2026-09-22): BC and BCE do not work by points, so a Request for
 * their own work has no use to them. Decision authority over other members'
 * Requests is unrelated and never gated by this.
 *
 * Reads the token's own claims rather than the capability row above: the
 * level number lives here, in one place, until `my_capabilities()` (#576)
 * carries the flag.
 */
export function submitsWorkRequests(claims: MemberClaims | null): boolean {
  return (claims?.member_level ?? 0) < 5;
}
