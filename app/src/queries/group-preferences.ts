import { useMemo } from 'react';
import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import {
  mutedGroupIds,
  type GroupPreferenceRow,
} from '../lib/preferred-groups';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

export async function fetchGroupPreferences(): Promise<GroupPreferenceRow[]> {
  const { data, error } = await supabase.rpc('my_group_preferences');
  if (error) throw error;
  return data ?? [];
}

/**
 * **Grupuri preferate** (ruling R43): one row per Group the member can see,
 * selected or not and why it is locked. The server answers nothing below
 * level 5 — the preference does not exist there — so an empty list means
 * "nothing to choose, nothing filtered".
 */
export function useGroupPreferences() {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.groups.preferences(memberId),
    queryFn: memberId ? fetchGroupPreferences : skipToken,
    staleTime: 5 * 60_000,
  });
}

/**
 * The Groups the member muted, for the default views. Empty while the read
 * is in flight or failed: a view never hides anything it is not sure of.
 */
export function useMutedGroupIds(): ReadonlySet<number> {
  const { data } = useGroupPreferences();
  return useMemo(() => mutedGroupIds(data), [data]);
}

/** What a page that opens on the preferred Groups needs: the muted Groups and the member. */
export function usePreferredGroupsData(): {
  muted: ReadonlySet<number>;
  memberId: string | undefined;
} {
  const muted = useMutedGroupIds();
  const memberId = useAuth().session?.user.id;
  return { muted, memberId };
}

/**
 * Saves the whole set of unselected Groups (`set_unselected_groups`, a
 * full-state replace). On success the Groups, the Anunțuri badge and
 * Clasament read again, since all three follow the preference.
 */
export function useSaveGroupPreferences() {
  const memberId = useAuth().session?.user.id;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (unselected: readonly number[]) => {
      const { data, error } = await supabase.rpc('set_unselected_groups', {
        p_group_ids: [...unselected],
      });
      if (error) throw error;
      return data ?? [];
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: keys.groups.preferences(memberId),
        }),
        queryClient.invalidateQueries({ queryKey: keys.announcements.all }),
        queryClient.invalidateQueries({ queryKey: keys.points.all }),
      ]);
    },
  });
}
