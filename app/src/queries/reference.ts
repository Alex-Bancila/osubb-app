import { useQuery } from '@tanstack/react-query';
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
>;

const GROUP_FIELDS =
  'id, name, short, color, category, path, parent_id, min_level, status, is_organization, legacy_dept_id';

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
      return new Map(data.map((group) => [group.id, group]));
    },
  });
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
