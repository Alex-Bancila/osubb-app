import { useMemo } from 'react';
import { skipToken, useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import type { Json } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import { keys } from './keys';
import { resolveGroupRoleLabel, useGroups, useRoles } from './reference';

/**
 * The Member Card (CONTEXT.md; ruling R6 of the 2026-09-23 grill): what any
 * active Member may see of a colleague — Nickname, full name, Role, join date
 * and Groups — plus contact details for the viewers already allowed them.
 *
 * Two reads, neither of which the browser decides:
 * - `public.member_card()` (#675) returns the projection for any Member, so an
 *   ordinary Member sees a colleague's Groups even outside their own rosters.
 *   It carries no contact column, no points and no rank.
 * - `profiles_contact` answers a row only for yourself or level ≥ 5; the
 *   presence of that row is the whole gate for the Contact section.
 */
export type MemberCardGroup = {
  id: number;
  name: string;
  /** `Name · Parent` when the parent is known, so two same-named teams differ. */
  label: string;
  color: string | null;
  roleLabel: string;
};

export type MemberCardData = {
  memberId: string;
  nickname: string | null;
  fullName: string;
  roleLabel: string | null;
  /** `YYYY-MM-DD`, or null when the join date was never recorded. */
  joinedAt: string | null;
  avatarColor: string | null;
  primaryGroup: { id: number; name: string; color: string | null } | null;
  /** The "+n" beside the primary Group chip. */
  otherMemberships: number;
  groups: MemberCardGroup[];
  contact: { email: string | null; phone: string | null } | null;
};

type CardRow = {
  member_id: string;
  nickname: string | null;
  full_name: string | null;
  role: string | null;
  joined_at: string | null;
  avatar_color: string | null;
  primary_group_id: number | null;
  primary_group_name: string | null;
  primary_group_color: string | null;
  other_memberships: number | null;
  memberships: Json;
};

export type MemberCardRows = {
  card: CardRow | null;
  contact: { email: string | null; phone: string | null } | null;
};

type Membership = {
  group_id: number;
  name: string;
  parent_id: number | null;
  color: string | null;
  group_role: string;
  position_title: string | null;
};

function memberships(value: Json): Membership[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const { group_id, name, parent_id, color, group_role, position_title } =
      item;
    if (typeof group_id !== 'number' || typeof name !== 'string') return [];
    return [
      {
        group_id,
        name,
        parent_id: typeof parent_id === 'number' ? parent_id : null,
        color: typeof color === 'string' ? color : null,
        group_role: typeof group_role === 'string' ? group_role : 'member',
        position_title:
          typeof position_title === 'string' ? position_title : null,
      },
    ];
  });
}

export async function fetchMemberCardRows(
  memberId: string,
): Promise<MemberCardRows> {
  const [card, contact] = await Promise.all([
    supabase.rpc('member_card', { p_member_id: memberId }).maybeSingle(),
    supabase
      .from('profiles_contact')
      .select('email, phone')
      .eq('id', memberId)
      .maybeSingle(),
  ]);
  if (card.error) throw card.error;
  if (contact.error) throw contact.error;
  return {
    card: (card.data as CardRow | null) ?? null,
    contact: contact.data ?? null,
  };
}

/**
 * The card as the screen renders it. Role names and Managers' titles come
 * from reference data when the viewer has it; nothing here needs it to render.
 */
export function toMemberCardData(
  { card, contact }: MemberCardRows,
  roles?: Map<string, { name: string }>,
  groups?: Map<number, { name: string; manager_title?: string | null }>,
): MemberCardData | null {
  // No row: the Member does not exist, or the viewer is not an active Member.
  if (!card) return null;
  const list = memberships(card.memberships);
  const names = new Map(list.map((item) => [item.group_id, item.name]));
  return {
    memberId: card.member_id,
    nickname: card.nickname?.trim() || null,
    fullName: card.full_name?.trim() || 'Membru OSUBB',
    roleLabel: card.role ? (roles?.get(card.role)?.name ?? card.role) : null,
    joinedAt: card.joined_at,
    avatarColor: card.avatar_color,
    primaryGroup:
      card.primary_group_id !== null && card.primary_group_name
        ? {
            id: card.primary_group_id,
            name: card.primary_group_name,
            color: card.primary_group_color,
          }
        : null,
    otherMemberships: card.other_memberships ?? 0,
    groups: list.map((item) => {
      const parent =
        item.parent_id === null
          ? null
          : (names.get(item.parent_id) ??
            groups?.get(item.parent_id)?.name ??
            null);
      return {
        id: item.group_id,
        name: item.name,
        label: parent ? `${item.name} · ${parent}` : item.name,
        color: item.color,
        roleLabel: resolveGroupRoleLabel(
          item.group_role,
          groups?.get(item.group_id)?.manager_title || 'Coordonator',
          item.position_title,
        ),
      };
    }),
    contact:
      contact && (contact.email || contact.phone)
        ? { email: contact.email, phone: contact.phone }
        : null,
  };
}

/** Read only while a card is open; one minute fresh, like every other profile. */
export function useMemberCard(memberId: string | null) {
  const viewerId = useAuth().session?.user.id;
  const roles = useRoles();
  const groups = useGroups();
  const rows = useQuery({
    queryKey: keys.members.card(memberId ?? '', viewerId),
    staleTime: 60_000,
    queryFn:
      memberId && viewerId ? () => fetchMemberCardRows(memberId) : skipToken,
  });
  const data = useMemo(
    () =>
      memberId && rows.data
        ? toMemberCardData(rows.data, roles.data, groups.data)
        : undefined,
    [memberId, rows.data, roles.data, groups.data],
  );
  return {
    data,
    isPending: rows.isPending,
    isError: rows.isError,
    refetch: async () => {
      await rows.refetch();
    },
  };
}
