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
 * `member_contacts()` and `points_ledger` each answer only what RLS lets the
 * viewer read, and the page renders exactly those rows.
 */
export type LedgerRow = {
  id: number;
  delta: number;
  reason: string;
  created_at: string;
  task_id: number | null;
  /** The Task's title, or null when the Task is not readable to the viewer. */
  task_title: string | null;
};

export type AdminMemberRows = MemberCardRows & {
  status: string | null;
  points: LedgerRow[];
};

export type AdminMember = MemberCardData & {
  /** The Role key (`voluntar`, …) the Role timeline starts from (#932). */
  role: string | null;
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
        // The embedded Task answers only what `tasks` RLS lets the viewer
        // read: null for anything else, and the page shows the id (B61).
        .select('id, delta, reason, created_at, task_id, tasks(title)')
        .eq('member_id', memberId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to),
    ),
  ]);
  if (profile.error) throw profile.error;
  return {
    ...rows,
    status: profile.data?.status ?? null,
    points: points.map(({ tasks, ...row }) => ({
      ...row,
      task_title: tasks?.title ?? null,
    })),
  };
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
      ? {
          ...card,
          role: rows.data.card?.role ?? null,
          status: rows.data.status,
          points: rows.data.points,
        }
      : null;
  }, [rows.data, roles.data, groups.data]);
  return { data, isPending: rows.isPending, isError: rows.isError };
}

/**
 * #675's write path for names: `profiles_update_self` lets a live BC or the
 * Moderator update any row, a BC's or the Moderator's included (#944, R31;
 * `memberEditRights` mirrors it), `guard_profile_privileged_columns` refuses a
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

/**
 * #932's write path for the join date: the same `profiles_update_self` policy
 * (a live BC or the Moderator updates any row, #944) and the column
 * grant `update (joined_at)` from #160; `guard_profile_privileged_columns`
 * refuses the change below level 6. `.single()` turns an RLS refusal (zero
 * rows) into a failure instead of a silent no-op.
 */
export async function updateMemberJoinedAt(input: {
  memberId: string;
  joinedAt: string;
}) {
  const { error } = await supabase
    .from('profiles')
    .update({ joined_at: input.joinedAt })
    .eq('id', input.memberId)
    .select('id')
    .single();
  if (error) throw error;
}

export function useUpdateMemberJoinedAt() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: updateMemberJoinedAt,
    // Tenure counts from the date: the Member Card, Profil and the promotion
    // progress bars all read it.
    onSuccess: async () => {
      await Promise.all(
        [keys.members.all, keys.profile.all, keys.points.all].map((queryKey) =>
          client.invalidateQueries({ queryKey }),
        ),
      );
    },
  });
}
