import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { can } from '../lib/capabilities';
import { supabase } from '../lib/supabase';

export type DirectoryMember = {
  id: string;
  name: string;
  role: string;
  status: string;
  departments: string[];
  teams: string[];
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
          .select('id, full_name, role, status')
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
          .select('id, name, category')
          .order('id')
          .range(from, to),
      ),
      readAllRows((from, to) =>
        supabase.from('roles').select('id, name').order('id').range(from, to),
      ),
      readAllRows((from, to) =>
        supabase
          .rpc('leadership_leaderboard', {})
          .order('member_id')
          .range(from, to),
      ),
    ]);
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const roleById = new Map(roles.map((role) => [role.id, role.name]));
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
  const pointsById = new Map(points.map((row) => [row.member_id, row.points]));
  return profiles.flatMap((profile) => {
    if (!profile.id) return [];
    const memberGroups = memberships
      .filter((membership) => membership.member_id === profile.id)
      .flatMap((membership) => {
        const group = groupById.get(membership.group_id);
        return group ? [group] : [];
      });
    return [
      {
        id: profile.id,
        name: profile.full_name ?? 'Membru',
        role: profile.role ? (roleById.get(profile.role) ?? profile.role) : '—',
        status: profile.status ?? '—',
        // Category is a presentation label here, never an authority decision.
        departments: memberGroups
          .filter((group) => group.category === 'department')
          .map((group) => group.name),
        teams: memberGroups
          .filter((group) => group.category === 'team')
          .map((group) => group.name),
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
