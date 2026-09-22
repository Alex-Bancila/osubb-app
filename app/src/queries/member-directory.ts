import { useQuery } from '@tanstack/react-query';
import { groupOptionLabel } from '../components/ui/combobox';
import { useAuth } from '../lib/auth';
import { can } from '../lib/capabilities';
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

export type DirectoryMember = {
  id: string;
  name: string;
  avatarColor: string | null;
  roleId: string | null;
  role: string;
  /** Higher is more senior; orders the role filter and sorting. */
  roleLevel: number;
  status: string;
  groups: DirectoryGroup[];
  points: number;
  contact: { email: string | null; phone: string | null } | undefined;
};

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
          .select('id, full_name, role, status, avatar_color')
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
          .select('member_id, group_id')
          .order('group_id')
          .order('member_id')
          .range(from, to),
      ),
      readAllRows((from, to) =>
        supabase
          .from('groups')
          .select('id, name, category, path, status, is_organization')
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
  }
  return profiles.flatMap((profile) => {
    if (!profile.id) return [];
    const role = profile.role ? roleById.get(profile.role) : undefined;
    return [
      {
        id: profile.id,
        name: profile.full_name ?? 'Membru',
        avatarColor: profile.avatar_color,
        roleId: profile.role,
        role: role?.name ?? profile.role ?? '—',
        roleLevel: role?.level ?? -1,
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
  const { session, claims } = useAuth();
  return useQuery({
    // Evaluation invalidations of ['points'] also refresh these point totals.
    queryKey: ['points', 'member-directory', { memberId: session?.user.id }],
    enabled: Boolean(session) && can(claims, 'seeDirectory'),
    queryFn: fetchMemberDirectory,
  });
}
