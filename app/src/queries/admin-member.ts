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
import type { Database } from '../lib/database.types';

type Card = Database['public']['Functions']['member_card']['Returns'][number];
export type CardMembership = {
  group_id: number;
  name: string;
  parent_id: number | null;
  color: string | null;
  group_role: string;
  position_title: string | null;
  joined_at: string;
};
export function cardMemberships(value: Card['memberships']): CardMembership[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (
      !row ||
      typeof row !== 'object' ||
      Array.isArray(row) ||
      typeof row.group_id !== 'number' ||
      typeof row.name !== 'string' ||
      typeof row.group_role !== 'string'
    )
      return [];
    return [
      {
        group_id: row.group_id,
        name: row.name,
        parent_id: typeof row.parent_id === 'number' ? row.parent_id : null,
        color: typeof row.color === 'string' ? row.color : null,
        group_role: row.group_role,
        position_title:
          typeof row.position_title === 'string' ? row.position_title : null,
        joined_at: typeof row.joined_at === 'string' ? row.joined_at : '',
      },
    ];
  });
}
export async function fetchAdminMember(memberId: string) {
  const [card, profile, contact, points] = await Promise.all([
    supabase.rpc('member_card', { p_member_id: memberId }).maybeSingle(),
    supabase
      .from('profiles_directory')
      .select('status')
      .eq('id', memberId)
      .maybeSingle(),
    supabase
      .from('profiles_contact')
      .select('email, phone')
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
  for (const result of [card, profile, contact])
    if (result.error) throw result.error;
  return card.data
    ? {
        card: card.data,
        memberships: cardMemberships(card.data.memberships),
        status: profile.data?.status,
        contact: contact.data,
        points,
      }
    : null;
}
export function useAdminMember(memberId: string | undefined) {
  const actor = useAuth().session?.user.id;
  return useQuery({
    queryKey: [...keys.members.all, 'admin-detail', { actor, memberId }],
    queryFn: actor && memberId ? () => fetchAdminMember(memberId) : skipToken,
  });
}
export async function updateMemberIdentity(input: {
  memberId: string;
  nickname: string;
  fullName: string;
}) {
  const { error } = await supabase
    .from('profiles')
    .update({
      nickname: input.nickname.trim() || null,
      full_name: input.fullName.trim(),
    })
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
