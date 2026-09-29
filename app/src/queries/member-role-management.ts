import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import { keys } from './keys';
import { readAllRows } from './groups-admin';

type MemberRole = Database['public']['Enums']['member_role'];
type MemberStatus = Database['public']['Enums']['member_status'];

export type MemberChange =
  | {
      kind: 'role';
      memberId: string;
      role: MemberRole;
      reason: string | null;
      /**
       * Ruling R31 (#905): who takes the rank when the change removes the last
       * live Moderator or BC. Sent only when named; the server refuses one
       * named where no guard applies.
       */
      replacementId?: string | null;
    }
  | {
      kind: 'status';
      memberId: string;
      status: MemberStatus;
      reason: string | null;
    };

/** Both commands write one Role History row; Status also revokes sessions in SQL. */
export async function changeMember(change: MemberChange) {
  const result =
    change.kind === 'role'
      ? await supabase.rpc('set_member_role', {
          p_member_id: change.memberId,
          p_role: change.role,
          p_reason: change.reason ?? undefined,
          p_replacement_id: change.replacementId ?? undefined,
        })
      : await supabase.rpc('set_member_status', {
          p_member_id: change.memberId,
          p_status: change.status,
          p_reason: change.reason ?? undefined,
        });
  if (result.error) throw result.error;
  return result.data;
}

export function useMemberChange() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: changeMember,
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: keys.groups.all }),
        client.invalidateQueries({ queryKey: ['member-role-groups'] }),
        client.invalidateQueries({ queryKey: keys.members.all }),
        client.invalidateQueries({ queryKey: keys.points.all }),
        // Leaving Voluntar closes an open Promotion Candidate (#826's trigger).
        client.invalidateQueries({ queryKey: keys.evaluation.all }),
      ]);
    },
  });
}

/** Explicit roster rows. Automatic Membership is derived from Group settings. */
export async function fetchMemberGroupIds(
  memberId: string,
): Promise<Set<number>> {
  const rows = await readAllRows((from, to) =>
    supabase
      .from('group_members')
      .select('group_id')
      .eq('member_id', memberId)
      .order('group_id')
      .range(from, to),
  );
  return new Set(rows.map((row) => row.group_id));
}

export function useMemberGroupIds(memberId: string | null) {
  const actorId = useAuth().session?.user.id;
  return useQuery({
    queryKey: ['member-role-groups', { actorId, memberId }],
    queryFn:
      actorId && memberId ? () => fetchMemberGroupIds(memberId) : skipToken,
  });
}
