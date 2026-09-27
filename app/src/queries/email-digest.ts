import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { reasonCopy } from '../lib/command-reasons';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

async function fetchDigestEnabled(memberId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('notification_email_preferences')
    .select('digest_enabled')
    .eq('member_id', memberId)
    .maybeSingle();
  if (error) throw error;
  // No row means the Member never turned it on: off.
  return data?.digest_enabled ?? false;
}

/**
 * The Member's Email Digest switch (#775): one email a day, at 07:00, listing
 * the Notifications they have not read. It is also the one-click opt-out
 * every digest links to (`/profil#rezumat-email`). One row per Member,
 * written through the self-only policies.
 */
export function useEmailDigest() {
  const { session } = useAuth();
  const memberId = session?.user.id;
  const queryClient = useQueryClient();
  const queryKey = keys.emailDigest.preference(memberId);

  const query = useQuery({
    queryKey,
    queryFn: memberId ? () => fetchDigestEnabled(memberId) : skipToken,
  });

  const mutation = useMutation({
    // Writes land in click order, as with the push preferences.
    scope: { id: `email-digest-${memberId ?? 'signed-out'}` },
    mutationFn: async (enabled: boolean) => {
      if (!memberId) throw new Error('not_signed_in');
      const { error } = await supabase
        .from('notification_email_preferences')
        .upsert(
          { member_id: memberId, digest_enabled: enabled },
          { onConflict: 'member_id' },
        );
      if (error) throw error;
    },
    // The switch moves at once; a refusal puts it back.
    onMutate: async (enabled) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<boolean>(queryKey) ?? false;
      queryClient.setQueryData<boolean>(queryKey, enabled);
      return { previous };
    },
    onError: (_error, _enabled, context) => {
      if (context) queryClient.setQueryData(queryKey, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  return {
    enabled: query.data ?? false,
    /** No successful read yet: the switch waits, so nobody flips a guess. */
    loading: query.data === undefined,
    pending: mutation.isPending,
    error: mutation.isError
      ? (reasonCopy('email_digest_preference_failed') ?? null)
      : query.data === undefined && query.isError
        ? (reasonCopy('email_digest_preference_unavailable') ?? null)
        : null,
    setEnabled: (enabled: boolean) => mutation.mutate(enabled),
  };
}
