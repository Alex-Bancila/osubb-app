import { useQuery } from '@tanstack/react-query';
import { groupOptionLabel } from '../components/ui/combobox';
import { useAuth } from '../lib/auth';
import { useCapability } from '../lib/capabilities';
import { supabase } from '../lib/supabase';

/** One Group a member belongs to, labelled `Name · Parent`. */
export type DirectoryGroup = {
  id: number;
  name: string;
  /** `Name · Parent` for a Child Group, `Name` for a top-level one. */
  label: string;
  category: string;
  /** Root-first ancestor ids ending with this Group's own id. */
  path: number[];
};

/** The Voluntari chip (R17): the Member's earliest-joined top-level Group. */
export type PrimaryGroup = { id: number; name: string; color: string | null };

export type DirectoryMember = {
  id: string;
  /** The full name. */
  name: string;
  /** The Member's Nickname (R5); the full name stands in when null. */
  nickname: string | null;
  avatarColor: string | null;
  roleId: string | null;
  role: string;
  /** Higher is more senior; orders the role filter and sorting. */
  roleLevel: number;
  status: string;
  /** Every explicit membership, kept only for the Group filter (path-based). */
  groups: DirectoryGroup[];
  /** The one chip Voluntari shows (R17): the earliest-joined top-level Group. */
  primaryGroup: PrimaryGroup | null;
  /** The "+n" beside the chip: the Member's other explicit memberships. */
  otherMemberships: number;
  points: number;
  contact: { email: string | null; phone: string | null } | undefined;
};

/** One explicit membership row, enough to pick the Voluntari chip (R17). */
export type MembershipCandidate = {
  id: number;
  name: string;
  color: string | null;
  parentId: number | null;
  createdAt: string;
};

/**
 * The same rule as `private.member_card_impl` (R6, R17): among a Member's
 * active, non-Organization explicit memberships, the chip is the top-level
 * one (no parent) with the earliest roster `created_at`; "+n" counts every
 * other explicit membership, top-level or not.
 */
export function primaryGroupOf(rows: MembershipCandidate[]): {
  primaryGroup: PrimaryGroup | null;
  otherMemberships: number;
} {
  const primary = rows
    .filter((row) => row.parentId === null)
    .sort(
      (a, b) =>
        Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id - b.id,
    )
    .at(0);
  return {
    primaryGroup: primary
      ? { id: primary.id, name: primary.name, color: primary.color }
      : null,
    otherMemberships: rows.length - (primary ? 1 : 0),
  };
}

// Supabase caps each response at 1,000 rows. Memberships can exceed that
// before the directory does, so every projection is read in stable pages.
async function readAllRows<T>(
  readPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await readPage(from, from + pageSize - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export async function fetchMemberDirectory(): Promise<DirectoryMember[]> {
  const [profiles, contacts, memberships, groups, roles, points] =
    await Promise.all([
      readAllRows((from, to) =>
        supabase
          .from('profiles_directory')
          .select('id, full_name, nickname, role, status, avatar_color')
          .order('id')
          .range(from, to),
      ),
      readAllRows((from, to) =>
        supabase
          .from('profiles_contact')
          .select('id, email, phone')
          .order('id')
          .range(from, to),
      ),
      readAllRows((from, to) =>
        supabase
          .from('group_members')
          .select('member_id, group_id, created_at')
          .order('group_id')
          .order('member_id')
          .range(from, to),
      ),
      readAllRows((from, to) =>
        supabase
          .from('groups')
          .select(
            'id, name, category, path, status, is_organization, parent_id, color',
          )
          .order('id')
          .range(from, to),
      ),
      readAllRows((from, to) =>
        supabase
          .from('roles')
          .select('id, name, level')
          .order('id')
          .range(from, to),
      ),
      readAllRows((from, to) =>
        supabase
          .rpc('leadership_leaderboard', {})
          .order('member_id')
          .range(from, to),
      ),
    ]);
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const roleById = new Map(roles.map((role) => [role.id, role]));
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
  const pointsById = new Map(points.map((row) => [row.member_id, row.points]));
  const groupsByMember = new Map<string, DirectoryGroup[]>();
  const membershipsByMember = new Map<string, MembershipCandidate[]>();
  for (const membership of memberships) {
    const group = groupById.get(membership.group_id);
    // Archived Groups and the Organization Group say nothing about a member.
    if (!group || group.status !== 'active' || group.is_organization) continue;
    const list = groupsByMember.get(membership.member_id) ?? [];
    list.push({
      id: group.id,
      name: group.name,
      label: groupOptionLabel(group, groupById),
      category: group.category,
      path: group.path,
    });
    groupsByMember.set(membership.member_id, list);

    const candidates = membershipsByMember.get(membership.member_id) ?? [];
    candidates.push({
      id: group.id,
      name: group.name,
      color: group.color,
      parentId: group.parent_id,
      createdAt: membership.created_at,
    });
    membershipsByMember.set(membership.member_id, candidates);
  }
  return profiles.flatMap((profile) => {
    if (!profile.id) return [];
    const role = profile.role ? roleById.get(profile.role) : undefined;
    const { primaryGroup, otherMemberships } = primaryGroupOf(
      membershipsByMember.get(profile.id) ?? [],
    );
    return [
      {
        id: profile.id,
        name: profile.full_name ?? 'Membru',
        nickname: profile.nickname?.trim() || null,
        avatarColor: profile.avatar_color,
        roleId: profile.role,
        role: role?.name ?? profile.role ?? '—',
        roleLevel: role?.level ?? -1,
        primaryGroup,
        otherMemberships,
        status: profile.status ?? '—',
        // Top-level Groups first, then by name, so a Department leads its teams.
        groups: (groupsByMember.get(profile.id) ?? []).sort(
          (a, b) =>
            a.path.length - b.path.length || a.name.localeCompare(b.name, 'ro'),
        ),
        points: pointsById.get(profile.id) ?? 0,
        contact: contactById.get(profile.id),
      },
    ];
  });
}

export function useMemberDirectory() {
  const { session } = useAuth();
  const seeDirectory = useCapability('seeDirectory').data === true;
  return useQuery({
    // Evaluation invalidations of ['points'] also refresh these point totals.
    queryKey: ['points', 'member-directory', { memberId: session?.user.id }],
    enabled: Boolean(session) && seeDirectory,
    queryFn: fetchMemberDirectory,
  });
}
