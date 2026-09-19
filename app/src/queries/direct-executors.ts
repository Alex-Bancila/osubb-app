import { skipToken, useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

// Keep each request below PostgREST's row cap. Every caller supplies a stable,
// unique order, including the composite Group membership key.
async function allPages<T>(
  read: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await read(offset, offset + 499);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 500) return rows;
  }
}

export async function fetchDirectExecutors() {
  const [profiles, roles, groups, memberships, campaigns, assignments] =
    await Promise.all([
      allPages((from, to) =>
        supabase
          .from('profiles_directory')
          .select('id, full_name, role, status')
          .eq('status', 'activ')
          .order('id')
          .range(from, to),
      ),
      allPages((from, to) =>
        supabase.from('roles').select('id, level').order('id').range(from, to),
      ),
      allPages((from, to) =>
        supabase
          .from('groups')
          .select('id, name, path, min_level, automatic_membership, status')
          .order('id')
          .range(from, to),
      ),
      allPages((from, to) =>
        supabase
          .from('group_members')
          .select('group_id, member_id')
          .order('group_id')
          .order('member_id')
          .range(from, to),
      ),
      allPages((from, to) =>
        supabase
          .from('campaigns')
          .select('id, name')
          .order('id')
          .range(from, to),
      ),
      allPages((from, to) =>
        supabase
          .from('task_assignments')
          .select(
            'id, member_id, task:tasks!task_assignments_task_id_fkey(campaign_id)',
          )
          .order('id')
          .range(from, to),
      ),
    ]);
  const levels = new Map(roles.map((role) => [role.id, role.level]));
  return {
    members: profiles
      .flatMap((profile) => {
        const level = profile.role ? levels.get(profile.role) : undefined;
        return profile.id && profile.status === 'activ' && level !== undefined
          ? [
              {
                id: profile.id,
                name: profile.full_name ?? 'Membru OSUBB',
                level,
              },
            ]
          : [];
      })
      .sort(
        (a, b) =>
          a.name.localeCompare(b.name, 'ro') || a.id.localeCompare(b.id),
      ),
    groups,
    memberships,
    campaigns,
    assignments,
  };
}

export type DirectExecutorData = Awaited<
  ReturnType<typeof fetchDirectExecutors>
>;

export function useDirectExecutors() {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.tasks.directExecutors(memberId),
    queryFn: memberId ? fetchDirectExecutors : skipToken,
  });
}

export function eligibleExecutors(
  data: DirectExecutorData,
  originGroupId: number,
) {
  const origin = data.groups.find((group) => group.id === originGroupId);
  return origin
    ? data.members.filter((member) => member.level >= origin.min_level)
    : [];
}

export function filterExecutors(
  data: DirectExecutorData,
  originGroupId: number,
  search: string,
  groupId: number | null,
  campaignId: number | null,
) {
  const descendants = data.groups.filter(
    (group) => groupId !== null && group.path.includes(groupId),
  );
  const normalize = (text: string) =>
    text
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('ro');
  return eligibleExecutors(data, originGroupId).filter(
    (member) =>
      normalize(member.name).includes(normalize(search.trim())) &&
      (groupId === null ||
        descendants.some(
          (group) =>
            (group.automatic_membership && member.level >= group.min_level) ||
            data.memberships.some(
              (membership) =>
                membership.group_id === group.id &&
                membership.member_id === member.id,
            ),
        )) &&
      (campaignId === null ||
        data.assignments.some(
          (assignment) =>
            assignment.member_id === member.id &&
            assignment.task?.campaign_id === campaignId,
        )),
  );
}
