import { useMemo } from 'react';
import { skipToken, useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

/**
 * Reference data: the lookup tables every screen reads to turn an id into
 * something a member recognises.
 *
 * `roles` is the classic shape — it changes in a migration and a deploy, so
 * `staleTime: Infinity` is the truth rather than an optimisation.
 *
 * `groups` is not. ADR-0009 makes one table — Departments, Teams, Projects and
 * the Adunarea Generală all live in `public.groups` — and Wave 3's Administrare
 * lets BC create, rename and archive them while the app is open. So it is
 * cached generously but not forever, and it is the source of a Group's
 * identity: its name, its short tag, its brand colour and its ancestor path all
 * come from the row, never from a map in a component.
 */

type GroupRow = Database['public']['Tables']['groups']['Row'];

/**
 * The Group columns any screen is allowed to need. `path` is root-first and
 * ends in the Group's own id, so `path[path.length - 2]` is the parent and
 * `path.length` is the depth — that is how a Child Group finds its Department
 * without a second request.
 *
 * `legacy_dept_id` is a Wave 1/2 bridge retained until the Wave 3 task that
 * drops `public.departments`; new Announcement reads use `group_id` directly.
 */
export type Group = Pick<
  GroupRow,
  | 'id'
  | 'name'
  | 'short'
  | 'color'
  | 'category'
  | 'path'
  | 'parent_id'
  | 'min_level'
  | 'status'
  | 'is_organization'
  | 'legacy_dept_id'
> & {
  manager_title?: string | null;
  automatic_membership?: boolean;
};

const GROUP_FIELDS =
  'id, name, short, color, category, path, parent_id, min_level, status, is_organization, manager_title, automatic_membership, legacy_dept_id';

/**
 * Every Group this member may read. RLS is the only filter — the browser asks
 * for no level or roster branch and receives exactly the Groups `groups_read`
 * admits.
 */
export function useGroups() {
  return useQuery({
    queryKey: keys.reference.groups(),
    // Groups are editable at runtime (Administrare), so not `Infinity`; five
    // minutes is long enough that every card on a screen shares one request.
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Map<number, Group>> => {
      const { data, error } = await supabase
        .from('groups')
        .select(GROUP_FIELDS);
      if (error) throw error;
      // A Map because every caller looks a Group up by id.
      return new Map(data.map((group) => [group.id, group as Group]));
    },
  });
}

export type GroupMemberRow = {
  group_id: number;
  group_role: 'manager' | 'responsible' | 'member';
  position_title: string | null;
};

export type MemberGroup = {
  id: number;
  name: string;
  short: string | null;
  color: string | null;
  category: Group['category'];
  group_role: 'manager' | 'responsible' | 'member';
  position_title: string | null;
  role_label: string;
};

/**
 * Resolves the Group Role label for display:
 * - Group Manager under the Group's `manager_title` (or fallback "Manager")
 * - Group Responsible under `position_title` (or fallback "Responsabil")
 * - Otherwise "Membru"
 */
export function resolveGroupRoleLabel(
  groupRole: 'manager' | 'responsible' | 'member' | string,
  managerTitle?: string | null,
  positionTitle?: string | null,
): string {
  if (groupRole === 'manager') {
    return managerTitle?.trim() || 'Manager';
  }
  if (groupRole === 'responsible') {
    return positionTitle?.trim() || 'Responsabil';
  }
  return 'Membru';
}

/**
 * Joins explicit `group_members` rows to `groups`, resolving the Group Role label,
 * and filtering out inactive and Organization groups (#108).
 */
export function buildMemberGroups(
  membershipRows: GroupMemberRow[] | undefined,
  groupsMap: Map<number, Group> | undefined,
): MemberGroup[] {
  if (!membershipRows || !groupsMap) return [];

  const result: MemberGroup[] = [];
  for (const row of membershipRows) {
    const group = groupsMap.get(row.group_id);
    if (!group || group.status !== 'active') continue;
    // The Organization Group is not listed (ruling R16)
    if (group.is_organization || group.category === 'organization') continue;

    const role_label = resolveGroupRoleLabel(
      row.group_role,
      group.manager_title,
      row.position_title,
    );

    result.push({
      id: group.id,
      name: group.name,
      short: group.short,
      color: group.color,
      category: group.category,
      group_role: row.group_role,
      position_title: row.position_title,
      role_label,
    });
  }

  return result.sort((a, b) => a.name.localeCompare(b.name, 'ro'));
}

/**
 * Hook to fetch the signed-in member's own group memberships from `group_members`
 * joined to `groups`. Memberships come from the tables, never from the `group_ids` claim.
 */
export function useMyGroups() {
  const { session } = useAuth();
  const id = session?.user.id;
  const groupsQuery = useGroups();

  const membershipQuery = useQuery({
    queryKey: keys.profile.groups(id),
    staleTime: 5 * 60_000,
    queryFn: id
      ? async (): Promise<GroupMemberRow[]> => {
          const { data, error } = await supabase
            .from('group_members')
            .select('group_id, group_role, position_title')
            .eq('member_id', id);
          if (error) throw error;
          return (data ?? []) as GroupMemberRow[];
        }
      : skipToken,
  });

  const data = useMemo(() => {
    return buildMemberGroups(membershipQuery.data, groupsQuery.data);
  }, [membershipQuery.data, groupsQuery.data]);

  return {
    data,
    membershipRows: membershipQuery.data,
    isPending: membershipQuery.isPending || groupsQuery.isPending,
    isError: membershipQuery.isError || groupsQuery.isError,
    error: membershipQuery.error ?? groupsQuery.error,
    refetch: async () => {
      await Promise.all([membershipQuery.refetch(), groupsQuery.refetch()]);
    },
  };
}

/**
 * Resolves the active Groups a member belongs to, accounting for both:
 * 1. Explicit roster rows recorded in `claims.group_ids`
 * 2. Automatic Membership (ADR-0009):
 *    - Organization Group (`automatic_membership = true`, `min_level = 0`) for every active member
 *    - Adunarea Generală (`automatic_membership = true`, `min_level = 3`) for voting members (level >= 3)
 */
export function resolveMemberGroups(
  groups: Map<number, Group> | undefined,
  options: {
    memberLevel?: number;
    explicitGroupIds?: number[];
  } = {},
): Group[] {
  if (!groups) return [];
  const explicit = new Set(options.explicitGroupIds ?? []);
  const level = options.memberLevel ?? 0;

  const result: Group[] = [];
  for (const group of groups.values()) {
    if (group.status !== 'active') continue;
    const isExplicit = explicit.has(group.id);
    const isAutomatic =
      Boolean(group.automatic_membership) && level >= group.min_level;
    if (isExplicit || isAutomatic) {
      result.push(group);
    }
  }

  return result.sort((a, b) => {
    if (a.is_organization !== b.is_organization) {
      return a.is_organization ? -1 : 1;
    }
    const categoryOrder: Record<string, number> = {
      organization: 0,
      department: 1,
      team: 2,
      project: 3,
    };
    const catA = categoryOrder[a.category] ?? 99;
    const catB = categoryOrder[b.category] ?? 99;
    if (catA !== catB) return catA - catB;
    return a.name.localeCompare(b.name, 'ro');
  });
}

/**
 * The role → display name → level ladder.
 *
 * The database already keeps the Romanian label for every role ("Membru cu
 * Drept de Vot"), so the UI reads it instead of carrying a second copy that
 * drifts. The level is here too, but note it is *not* the authority for
 * anything: what the UI offers comes from the server capability row
 * (`useCapabilities()` in `capabilities.ts`), and the database decides.
 */
export function useRoles() {
  return useQuery({
    queryKey: keys.reference.roles(),
    staleTime: Infinity,
    queryFn: async (): Promise<
      Map<string, { name: string; level: number }>
    > => {
      const { data, error } = await supabase
        .from('roles')
        .select('id, name, level');
      if (error) throw error;
      return new Map(data.map((role) => [role.id, role]));
    },
  });
}

/**
 * The Rating and Difficulty scales an evaluator chooses from. The labels and
 * multipliers live in migrations (house rule 6), so the evaluation form reads
 * them rather than hard-coding a second copy; the server still computes the
 * points (`private.evaluate_task`) — anything shown from this is a preview.
 */
export function useEvaluationScale() {
  return useQuery({
    queryKey: keys.reference.evaluationScale(),
    staleTime: Infinity,
    queryFn: async () => {
      const [ratings, difficulties] = await Promise.all([
        supabase
          .from('rating_guide')
          .select('rating, multiplier, label')
          .order('rating'),
        supabase.from('difficulty_guide').select('stars, note').order('stars'),
      ]);
      if (ratings.error) throw ratings.error;
      if (difficulties.error) throw difficulties.error;
      return { ratings: ratings.data, difficulties: difficulties.data };
    },
  });
}
