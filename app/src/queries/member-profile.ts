import { useMemo } from 'react';
import { skipToken, useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { groupOptionLabel } from '../components/ui/combobox';
import { keys } from './keys';
import {
  buildMemberGroups,
  useGroups,
  useRoles,
  type GroupMemberRow,
  type MemberGroup,
} from './reference';

/**
 * Another member's profile summary, as far as the viewer may see it.
 *
 * Every part comes from an RLS-backed read and simply comes back empty when
 * the viewer is not allowed it: `profiles_directory` names every active
 * member; `profiles_contact` answers only for yourself or rank BCE and above;
 * `group_members` answers for your own rows, rank BCE and above, and the
 * rosters you manage. The browser never decides who may see what.
 */
export type MemberProfileSummary = {
  id: string;
  fullName: string;
  avatarColor: string | null;
  roleLabel: string | null;
  joinedYear: number | null;
  /** Each Group with its `Name · Parent` label, so two same-named teams differ. */
  groups: (MemberGroup & { label: string })[];
  email: string | null;
  phone: string | null;
};

type MemberProfileRows = {
  profile: {
    full_name: string | null;
    avatar_color: string | null;
    role: string | null;
    joined_year: number | null;
  } | null;
  contact: { email: string | null; phone: string | null } | null;
  memberships: GroupMemberRow[];
};

export async function fetchMemberProfileRows(
  memberId: string,
): Promise<MemberProfileRows> {
  const [profile, contact, memberships] = await Promise.all([
    supabase
      .from('profiles_directory')
      .select('full_name, avatar_color, role, joined_year')
      .eq('id', memberId)
      .maybeSingle(),
    supabase
      .from('profiles_contact')
      .select('email, phone')
      .eq('id', memberId)
      .maybeSingle(),
    supabase
      .from('group_members')
      .select('group_id, group_role, position_title')
      .eq('member_id', memberId),
  ]);
  if (profile.error) throw profile.error;
  if (contact.error) throw contact.error;
  if (memberships.error) throw memberships.error;
  return {
    profile: profile.data,
    contact: contact.data,
    memberships: (memberships.data ?? []) as GroupMemberRow[],
  };
}

export function useMemberProfile(memberId: string | null) {
  const viewerId = useAuth().session?.user.id;
  const groups = useGroups();
  const roles = useRoles();
  const rows = useQuery({
    queryKey: keys.members.profile(memberId ?? '', viewerId),
    staleTime: 60_000,
    queryFn:
      memberId && viewerId ? () => fetchMemberProfileRows(memberId) : skipToken,
  });
  const data = useMemo((): MemberProfileSummary | undefined => {
    if (!memberId || !rows.data) return undefined;
    const { profile, contact, memberships } = rows.data;
    return {
      id: memberId,
      fullName: profile?.full_name ?? 'Membru OSUBB',
      avatarColor: profile?.avatar_color ?? null,
      roleLabel: profile?.role
        ? (roles.data?.get(profile.role)?.name ?? null)
        : null,
      joinedYear: profile?.joined_year ?? null,
      groups: buildMemberGroups(memberships, groups.data).map((group) => {
        const row = groups.data?.get(group.id);
        return {
          ...group,
          label:
            row && groups.data
              ? groupOptionLabel(row, groups.data)
              : group.name,
        };
      }),
      email: contact?.email ?? null,
      phone: contact?.phone ?? null,
    };
  }, [memberId, rows.data, roles.data, groups.data]);
  return {
    data,
    isPending: rows.isPending || groups.isPending,
    isError: rows.isError || groups.isError,
    refetch: async () => {
      await Promise.all([rows.refetch(), groups.refetch()]);
    },
  };
}
