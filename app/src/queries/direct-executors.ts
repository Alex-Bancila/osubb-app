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
  const [profiles, roles, groups, memberships] = await Promise.all([
    allPages((from, to) =>
      supabase
        .from('profiles_directory')
        .select('id, full_name, role, status, avatar_color')
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
                avatarColor: profile.avatar_color,
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
  };
}

export type DirectExecutorData = Awaited<
  ReturnType<typeof fetchDirectExecutors>
>;
export type DirectExecutor = DirectExecutorData['members'][number];
export type DirectExecutorGroup = DirectExecutorData['groups'][number];

export function useDirectExecutors() {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.tasks.directExecutors(memberId),
    queryFn: memberId ? fetchDirectExecutors : skipToken,
  });
}

/** Active Members at or above the Origin Group's Minimum Level (ADR-0009). */
export function eligibleExecutors(
  data: DirectExecutorData,
  originGroupId: number,
) {
  const origin = data.groups.find((group) => group.id === originGroupId);
  return origin
    ? data.members.filter((member) => member.level >= origin.min_level)
    : [];
}

/**
 * The eligible Members who belong to `groupId` or to any Group below it. The
 * Group filter narrows the list; it never makes anyone eligible.
 */
export function filterExecutors(
  data: DirectExecutorData,
  originGroupId: number,
  groupId: number | null,
) {
  const eligible = eligibleExecutors(data, originGroupId);
  if (groupId === null) return eligible;
  const branch = data.groups.filter((group) => group.path.includes(groupId));
  const branchIds = new Set(branch.map((group) => group.id));
  const listed = new Set(
    data.memberships
      .filter((membership) => branchIds.has(membership.group_id))
      .map((membership) => membership.member_id),
  );
  const automaticMinimum = Math.min(
    ...branch
      .filter((group) => group.automatic_membership)
      .map((group) => group.min_level),
  );
  return eligible.filter(
    (member) => listed.has(member.id) || member.level >= automaticMinimum,
  );
}
