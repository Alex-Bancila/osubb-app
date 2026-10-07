import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

/**
 * The Atribuții BC (ruling R44), each with exactly one holder. Only
 * Responsabil OSUBB Deals exists; the three placeholders the ruling names
 * (Pagina Interne, Anunțuri Educaționale, Anunțuri de Tineret) join this list
 * when the server knows them.
 */
export const ASSIGNMENTS = [
  { id: 'osubb_deals', label: 'Responsabil OSUBB Deals' },
] as const;

export type AssignmentId = (typeof ASSIGNMENTS)[number]['id'];

export function assignmentLabel(id: string): string {
  return ASSIGNMENTS.find((assignment) => assignment.id === id)?.label ?? id;
}

/** Atribuție → the BC member holding it. */
export type AssignmentHolders = ReadonlyMap<string, string>;

export async function fetchAssignmentHolders(): Promise<AssignmentHolders> {
  const { data, error } = await supabase
    .from('bc_assignments')
    .select('assignment, member_id');
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.assignment, row.member_id]));
}

export function useAssignmentHolders(enabled = true) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.assignments.holders(memberId),
    queryFn: memberId && enabled ? fetchAssignmentHolders : skipToken,
  });
}

export type SetBcAssignmentInput = {
  assignment: string;
  memberId: string;
  granted: boolean;
  /** Take it from its current holder (the Moderator confirmed the move). */
  move?: boolean;
};

/**
 * Give or take back an Atribuție (R44), Moderator only. Giving one that
 * another BC member holds is refused (`bc_assignment_held`) unless `move`;
 * taking it back dissolves its team and tells the three of them.
 */
export async function setBcAssignment({
  assignment,
  memberId,
  granted,
  move = false,
}: SetBcAssignmentInput): Promise<void> {
  const { error } = await supabase.rpc('set_bc_assignment', {
    p_assignment: assignment,
    p_member_id: memberId,
    p_granted: granted,
    p_move: move,
  });
  if (error) throw error;
}

export function useSetBcAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setBcAssignment,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.assignments.all }),
        queryClient.invalidateQueries({ queryKey: ['capabilities'] }),
      ]);
    },
  });
}
