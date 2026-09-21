import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
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
 * `legacy_dept_id` is a Wave 1/2 bridge, not part of the Group model: it is
 * here only so `DeptCupCard` can join `dept_cup`'s legacy-keyed rows onto their
 * Group until the view carries `group_id`. It goes with the column, in the
 * Wave 3 task that drops `public.departments`.
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
  automatic_membership?: boolean;
};

const GROUP_FIELDS =
  'id, name, short, color, category, path, parent_id, min_level, status, is_organization, automatic_membership, legacy_dept_id';

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
 * Membership-aware hook that resolves all Groups the authenticated member
 * belongs to (explicit memberships + automatic Organization & AG memberships).
 */
export function useMyGroups(memberLevelOverride?: number) {
  const { claims } = useAuth();
  const groupsQuery = useGroups();
  const memberLevel = memberLevelOverride ?? claims?.member_level ?? 0;
  const explicitGroupIds = claims?.group_ids;

  const data = useMemo(
    () =>
      resolveMemberGroups(groupsQuery.data, {
        memberLevel,
        explicitGroupIds,
      }),
    [groupsQuery.data, memberLevel, explicitGroupIds],
  );

  return {
    ...groupsQuery,
    data,
  };
}

/**
 * The role → display name → level ladder.
 *
 * The database already keeps the Romanian label for every role ("Membru cu
 * Drept de Vot"), so the UI reads it instead of carrying a second copy that
 * drifts. The level is here too, but note it is *not* the authority for
 * anything: permissions come from the claims in the token (`capabilities.ts`).
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
