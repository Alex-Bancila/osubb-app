import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

/**
 * Reference data: the lookup tables seeded by migrations (`0001_core_schema`).
 *
 * Two things make these different from every other query in the app:
 *
 *  1. **They cannot change while the app is open.** A new department is a
 *     migration and a deploy, so `staleTime: Infinity` is the truth, not an
 *     optimisation — refetching them on window focus would be pure noise.
 *  2. **They are the source of a department's identity** — its name, its short
 *     tag and its brand colour all live in the row. Screens read the colour
 *     from here rather than from a hardcoded map, so adding the sixth
 *     department is an insert, not a pull request (mini-spec §6).
 */

export type Department = {
  id: string;
  name: string;
  short: string;
  color: string;
  kind: string;
};

export function useDepartments() {
  return useQuery({
    queryKey: keys.reference.departments(),
    staleTime: Infinity,
    queryFn: async (): Promise<Map<string, Department>> => {
      const { data, error } = await supabase
        .from('departments')
        .select('id, name, short, color, kind');
      if (error) throw error;
      // A Map because every caller looks a department up by id.
      return new Map(data.map((dept) => [dept.id, dept]));
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
