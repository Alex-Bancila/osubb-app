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

export async function fetchMemberDirectory(): Promise<DirectoryMember[]> {
  const [profiles, contacts, memberships, groups, roles, points] =
    await Promise.all([
      supabase
        .from('profiles_directory')
        .select('id, full_name, role, status')
        .order('full_name'),
      supabase.from('profiles_contact').select('id, email, phone'),
      supabase.from('group_members').select('member_id, group_id'),
      supabase.from('groups').select('id, name, category'),
      supabase.from('roles').select('id, name'),
      supabase.rpc('leadership_leaderboard', {}),
    ]);
  for (const result of [
    profiles,
    contacts,
    memberships,
    groups,
    roles,
    points,
  ]) {
    if (result.error) throw result.error;
  }
  const groupById = new Map(groups.data?.map((group) => [group.id, group]));
  const roleById = new Map(roles.data?.map((role) => [role.id, role.name]));
  const contactById = new Map(
    contacts.data?.map((contact) => [contact.id, contact]),
  );
  const pointsById = new Map(
    points.data?.map((row) => [row.member_id, row.points]),
  );
  return (profiles.data ?? []).flatMap((profile) => {
    if (!profile.id) return [];
    const memberGroups = (memberships.data ?? [])
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
