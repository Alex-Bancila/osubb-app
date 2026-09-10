import { skipToken, useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { keys } from './keys';

/**
 * My own profile row.
 *
 * The token knows what I may do — role, level, departments — but not who I am:
 * claims carry no name, and `session.user.email` is an address, not a person.
 * So the greeting, the sidebar and the avatar colour come from here.
 *
 * `email` is deliberately absent from the select. The column is revoked from
 * `authenticated` (contact details go through `profiles_contact`, gated at
 * level >= 5), so asking for it would fail — for my own row too.
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

async function fetchMyProfile(memberId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, status, tier, avatar_color, joined_year')
    .eq('id', memberId)
    .single();
  if (error) throw error;
  return data;
}
