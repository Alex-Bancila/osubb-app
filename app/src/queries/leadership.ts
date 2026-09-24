import { skipToken, useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import type { WorkFilterParams } from '../lib/work-filter';
import { keys } from './keys';
import {
  primaryGroupOf,
  type MembershipCandidate,
  type PrimaryGroup,
} from './member-directory';

type Functions = Database['public']['Functions'];
export type LeaderboardRow =
  Functions['leadership_leaderboard']['Returns'][number];
export type CupRow = Functions['department_cup']['Returns'][number];
export type MemberTask =
  Functions['leadership_member_tasks']['Returns'][number];
/** The Work Filter's arguments (#677, #678); the Cup takes all but the Group. */
export type LeadershipFilters = WorkFilterParams;
export type CupFilters = Omit<WorkFilterParams, 'p_group_id'>;
/** The Member tracker's range reads the Task deadline (#677); no Group, no Campaign. */
export type MemberTaskRange = Pick<WorkFilterParams, 'p_from' | 'p_to'>;

async function pages<T>(
  read: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await read(offset, offset + 499);
    if (page.error) throw page.error;
    if (!page.data) throw new Error('Missing leadership response');
    rows.push(...page.data);
    if (page.data.length < 500) return rows;
  }
}
export function fetchLeadershipLeaderboard(filters: LeadershipFilters) {
  return pages<LeaderboardRow>((from, to) =>
    supabase
      .rpc('leadership_leaderboard', filters)
      .order('points', { ascending: false })
      .order('member_id')
      .range(from, to),
  );
}
export function fetchLeadershipCup(filters: CupFilters) {
  return pages<CupRow>((from, to) =>
    supabase
      .rpc('department_cup', filters)
      .order('points', { ascending: false })
      .order('name')
      .order('group_id')
      .range(from, to),
  );
}
export function fetchLeadershipMemberTasks(
  memberId: string,
  range: MemberTaskRange = {},
) {
  return pages<MemberTask>((from, to) =>
    supabase
      .rpc('leadership_member_tasks', { p_member_id: memberId, ...range })
      .order('assigned_at', { ascending: false })
      .order('assignment_id')
      .range(from, to),
  );
}
export async function fetchLeadershipFilters() {
  const [groups, campaigns] = await Promise.all([
    pages((from, to) =>
      supabase
        .from('groups')
        .select('id,name,path,status,is_organization,parent_id,color,category')
        .order('id')
        .range(from, to),
    ),
    pages((from, to) =>
      supabase
        .from('campaigns')
        .select('id,name,group_id')
        .order('id')
        .range(from, to),
    ),
  ]);
  return { groups, campaigns };
}
/** `null` filters (an inverted date range) send nothing. */
export function useLeadershipLeaderboard(filters: LeadershipFilters | null) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.points.leadership(memberId, filters),
    queryFn:
      memberId && filters
        ? () => fetchLeadershipLeaderboard(filters)
        : skipToken,
  });
}
/** `null` filters (an inverted date range) send nothing. */
export function useLeadershipCup(filters: CupFilters | null) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.points.leadershipCup(memberId, filters),
    queryFn:
      memberId && filters ? () => fetchLeadershipCup(filters) : skipToken,
  });
}
export function useLeadershipFilters() {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.leadership.filters(memberId),
    queryFn: memberId ? fetchLeadershipFilters : skipToken,
  });
}
/** `null` range (an inverted one) sends nothing. */
export function useLeadershipMemberTasks(
  targetId: string,
  range: MemberTaskRange | null = {},
) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.tasks.memberHistory(memberId, targetId, range),
    queryFn:
      memberId && range
        ? () => fetchLeadershipMemberTasks(targetId, range)
        : skipToken,
  });
}

/**
 * What a Clasament row shows beside the Nickname (R11, R17): the avatar colour
 * and the Voluntari chip — the Member's earliest-joined top-level Group — with
 * "+n" for their other explicit memberships. The same rule as
 * `private.member_card_impl`, computed for a whole page of rows at once so a
 * board of a hundred Members costs a handful of reads, not a hundred cards.
 */
export type LeaderboardIdentity = {
  avatarColor: string | null;
  primaryGroup: PrimaryGroup | null;
  otherMemberships: number;
};

// A uuid is 36 characters; a hundred of them keep each `in.(…)` URL small.
const ID_CHUNK = 100;

export async function fetchLeaderboardIdentities(
  memberIds: readonly string[],
): Promise<Record<string, LeaderboardIdentity>> {
  const chunks: string[][] = [];
  for (let index = 0; index < memberIds.length; index += ID_CHUNK)
    chunks.push(memberIds.slice(index, index + ID_CHUNK));
  const [groups, profiles, memberships] = await Promise.all([
    pages((from, to) =>
      supabase
        .from('groups')
        .select('id,name,parent_id,color,status,is_organization')
        .order('id')
        .range(from, to),
    ),
    Promise.all(
      chunks.map((ids) =>
        pages((from, to) =>
          supabase
            .from('profiles_directory')
            .select('id,avatar_color')
            .in('id', ids)
            .order('id')
            .range(from, to),
        ),
      ),
    ),
    Promise.all(
      chunks.map((ids) =>
        pages((from, to) =>
          supabase
            .from('group_members')
            .select('member_id,group_id,created_at')
            .in('member_id', ids)
            .order('member_id')
            .order('group_id')
            .range(from, to),
        ),
      ),
    ),
  ]);
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const candidates = new Map<string, MembershipCandidate[]>();
  for (const row of memberships.flat()) {
    const group = groupById.get(row.group_id);
    // Archived Groups and the Organization Group say nothing about a Member.
    if (!group || group.status !== 'active' || group.is_organization) continue;
    const list = candidates.get(row.member_id) ?? [];
    list.push({
      id: group.id,
      name: group.name,
      color: group.color,
      parentId: group.parent_id,
      createdAt: row.created_at,
    });
    candidates.set(row.member_id, list);
  }
  const colours = new Map(
    profiles.flat().map((profile) => [profile.id, profile.avatar_color]),
  );
  return Object.fromEntries(
    memberIds.map((id) => [
      id,
      {
        avatarColor: colours.get(id) ?? null,
        ...primaryGroupOf(candidates.get(id) ?? []),
      },
    ]),
  );
}

/** Read once per set of Members on the board; the order does not matter. */
export function useLeaderboardIdentities(memberIds: readonly string[]) {
  const viewerId = useAuth().session?.user.id;
  const ids = [...new Set(memberIds)].sort();
  return useQuery({
    queryKey: keys.members.identities(viewerId, ids),
    staleTime: 60_000,
    queryFn:
      viewerId && ids.length
        ? () => fetchLeaderboardIdentities(ids)
        : skipToken,
  });
}
