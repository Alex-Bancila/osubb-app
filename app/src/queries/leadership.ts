import { skipToken, useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

type Functions = Database['public']['Functions'];
export type LeaderboardRow =
  Functions['leadership_leaderboard']['Returns'][number];
export type CupRow = Functions['department_cup']['Returns'][number];
export type MemberTask =
  Functions['leadership_member_tasks']['Returns'][number];
export type LeadershipFilters = { groupId?: number; campaignId?: number };

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
      .rpc('leadership_leaderboard', {
        p_group_id: filters.groupId,
        p_campaign_id: filters.campaignId,
      })
      .order('points', { ascending: false })
      .order('member_id')
      .range(from, to),
  );
}
export function fetchLeadershipCup(campaignId?: number) {
  return pages<CupRow>((from, to) =>
    supabase
      .rpc('department_cup', { p_campaign_id: campaignId })
      .order('points', { ascending: false })
      .order('name')
      .order('group_id')
      .range(from, to),
  );
}
export function fetchLeadershipMemberTasks(memberId: string) {
  return pages<MemberTask>((from, to) =>
    supabase
      .rpc('leadership_member_tasks', { p_member_id: memberId })
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
        .select('id,name,path,status')
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
export function useLeadershipLeaderboard(filters: LeadershipFilters) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.points.leadership(memberId, filters),
    queryFn: memberId ? () => fetchLeadershipLeaderboard(filters) : skipToken,
  });
}
export function useLeadershipCup(campaignId?: number) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.points.leadershipCup(memberId, campaignId),
    queryFn: memberId ? () => fetchLeadershipCup(campaignId) : skipToken,
  });
}
export function useLeadershipFilters() {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.leadership.filters(memberId),
    queryFn: memberId ? fetchLeadershipFilters : skipToken,
  });
}
export function useLeadershipMemberTasks(targetId: string) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.tasks.memberHistory(memberId, targetId),
    queryFn: memberId ? () => fetchLeadershipMemberTasks(targetId) : skipToken,
  });
}

/** Who the tracker page is about: enough to render their name button. */
export type LeadershipMember = {
  fullName: string;
  nickname: string | null;
  avatarColor: string | null;
};

export function useLeadershipMember(targetId: string) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.leadership.memberName(memberId, targetId),
    queryFn: memberId
      ? async (): Promise<LeadershipMember | null> => {
          const { data, error } = await supabase
            .from('profiles_directory')
            .select('full_name, nickname, avatar_color')
            .eq('id', targetId)
            .maybeSingle();
          if (error) throw error;
          if (!data?.full_name) return null;
          return {
            fullName: data.full_name,
            nickname: data.nickname?.trim() || null,
            avatarColor: data.avatar_color,
          };
        }
      : skipToken,
  });
}
