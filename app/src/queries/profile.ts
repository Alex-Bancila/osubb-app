import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { keys } from './keys';

export type MyProfile = {
  id: string;
  full_name: string;
  /** The Nickname (#675, R5); `null` means the full name stands in. */
  nickname: string | null;
  role: Database['public']['Enums']['member_role'];
  status: Database['public']['Enums']['member_status'];
  avatar_color: string | null;
  joined_year: number | null;
  joined_at: string | null;
  email: string | null;
  phone: string | null;
};

/**
 * The columns a Member writes on their own row (#675, #699): the Nickname, the
 * phone and the avatar colour. The full name is not one of them -- only BC and
 * the Moderator change it, and never through the edit sheet.
 */
export type UpdateMyProfileInput = {
  nickname?: string | null;
  phone?: string | null;
  avatarColor?: string | null;
};

/**
 * My own profile row, combining basic info from `profiles` and contact info
 * from the owner-rights `profiles_contact` view.
 *
 * The token knows what I may do — role, level, departments — but not who I am:
 * claims carry no name, and `session.user.email` is an address, not a person.
 * So the greeting, the sidebar, contact information and avatar colour come from here.
 *
 * `email` and `phone` are revoked from `authenticated` on table `profiles` directly
 * and must be read through `profiles_contact`, which is granted to SELF or level >= 5.
 */
export function useMyProfile() {
  const { session } = useAuth();
  const id = session?.user.id;

  return useQuery({
    queryKey: keys.profile.me(id),
    // Your own name and colour do not change while you look at a screen.
    staleTime: 5 * 60_000,
    queryFn: id ? () => fetchMyProfile(id) : skipToken,
  });
}

export async function fetchMyProfile(memberId: string): Promise<MyProfile> {
  const [profileRes, contactRes] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'id, full_name, nickname, role, status, avatar_color, joined_year, joined_at',
      )
      .eq('id', memberId)
      .single(),
    supabase
      .from('profiles_contact')
      .select('email, phone')
      .eq('id', memberId)
      .maybeSingle(),
  ]);

  if (profileRes.error) throw profileRes.error;
  if (contactRes.error) throw contactRes.error;

  return {
    ...profileRes.data,
    email: contactRes.data?.email ?? null,
    phone: contactRes.data?.phone ?? null,
  };
}

/**
 * Mutation to update own profile fields: nickname, phone, avatar_color.
 *
 * Database security boundary:
 * 1. RLS policy `profiles_update_self` allows updates where `id = auth.uid()`.
 * 2. Trigger `guard_profile_privileged_columns()` rejects changes to
 *    `full_name, role, status, email, tier, joined_year, joined_at` unless level >= 6
 *    (#675: the full name is BC/Moderator's), so `full_name` is never sent here.
 *    Trigger `profiles_guard_nickname` trims the Nickname, turns blank into null
 *    and names the reason one is refused (`nickname_too_short` ... `nickname_taken`).
 * 3. Crucially, the update statement does NOT use `.select('phone')` because `phone` is revoked from
 *    `authenticated` on the table directly. We invalidate `keys.profile.all` to refetch via `profiles_contact`.
 */
export function useUpdateMyProfile() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const id = session?.user.id;

  return useMutation({
    mutationFn: async (input: UpdateMyProfileInput) => {
      if (!id) throw new Error('Not authenticated');

      const updates: Database['public']['Tables']['profiles']['Update'] = {};
      if (input.nickname !== undefined)
        updates.nickname = input.nickname?.trim() || null;
      if (input.phone !== undefined)
        updates.phone = input.phone ? input.phone.trim() : null;
      if (input.avatarColor !== undefined)
        updates.avatar_color = input.avatarColor;

      const { error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.profile.all });
      // Member Cards and lists name me by my Nickname (R5).
      void queryClient.invalidateQueries({ queryKey: keys.members.all });
    },
  });
}
