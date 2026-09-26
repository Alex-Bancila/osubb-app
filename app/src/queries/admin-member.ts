import { useMemo } from 'react';
import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { keys } from './keys';
import { readAllRows } from './groups-admin';
import {
  fetchMemberCardRows,
  toMemberCardData,
  type MemberCardData,
  type MemberCardRows,
} from './member-card';
import { useGroups, useRoles } from './reference';

/**
 * A Member's page in Administrare (#103). Nothing here decides who may see
 * what: the Member Card projection (#675, Private Groups filtered by #756),
 * `profiles_contact` and `points_ledger` each answer only what RLS lets the
 * viewer read, and the page renders exactly those rows.
 */
export type LedgerRow = {
  id: number;
  delta: number;
  reason: string;
  created_at: string;
  task_id: number | null;
};

export type AdminMemberRows = MemberCardRows & {
  status: string | null;
  points: LedgerRow[];
};

export type AdminMember = MemberCardData & {
  status: string | null;
  points: LedgerRow[];
};

export async function fetchAdminMember(
  memberId: string,
): Promise<AdminMemberRows> {
  const [rows, profile, points] = await Promise.all([
    fetchMemberCardRows(memberId),
    supabase
      .from('profiles_directory')
      .select('status')
      .eq('id', memberId)
      .maybeSingle(),
    readAllRows((from, to) =>
      supabase
        .from('points_ledger')
        .select('id, delta, reason, created_at, task_id')
        .eq('member_id', memberId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to),
    ),
  ]);
  if (profile.error) throw profile.error;
  return { ...rows, status: profile.data?.status ?? null, points };
}

export function useAdminMember(memberId: string | undefined) {
  const viewerId = useAuth().session?.user.id;
  const roles = useRoles();
  const groups = useGroups();
  const rows = useQuery({
    queryKey: keys.members.admin(memberId ?? '', viewerId),
    queryFn:
      viewerId && memberId ? () => fetchAdminMember(memberId) : skipToken,
  });
  const data = useMemo((): AdminMember | null | undefined => {
    if (!rows.data) return undefined;
    const card = toMemberCardData(rows.data, roles.data, groups.data);
    return card
      ? { ...card, status: rows.data.status, points: rows.data.points }
      : null;
  }, [rows.data, roles.data, groups.data]);
  return { data, isPending: rows.isPending, isError: rows.isError };
}

/**
 * #675's write path for names: `profiles_update_self` lets BC and the
 * Moderator update any row, `guard_profile_privileged_columns` refuses a
 * changed full name below level 6, and `guard_profile_nickname` names the
 * reason a Nickname is refused. `.single()` requires the row back, so an RLS
 * refusal (zero rows) fails instead of looking like a save.
 */
export async function updateMemberIdentity(input: {
  memberId: string;
  nickname: string | null;
  fullName: string;
}) {
  const { error } = await supabase
    .from('profiles')
    .update({ nickname: input.nickname, full_name: input.fullName })
    .eq('id', input.memberId)
    .select('id')
    .single();
  if (error) throw error;
}

export function useUpdateMemberIdentity() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: updateMemberIdentity,
    onSuccess: async () => {
      await Promise.all(
        [keys.members.all, keys.groups.all, keys.profile.all].map((queryKey) =>
          client.invalidateQueries({ queryKey }),
        ),
      );
    },
  });
}
