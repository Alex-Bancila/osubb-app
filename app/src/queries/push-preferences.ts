import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { reasonCopy } from '../lib/command-reasons';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

type NotificationKind = Database['public']['Enums']['noti_kind'];

/**
 * The kinds a Member may mute on their devices (#635, ruling R17). `task`,
 * `system` and critical Announcements always push; the table's check
 * constraint refuses a row for the first two, and a critical Announcement
 * ignores the `announce` row.
 */
export const MUTABLE_PUSH_KINDS = [
  'announce',
  'event',
  'deadline',
] as const satisfies readonly NotificationKind[];

export type MutablePushKind = (typeof MUTABLE_PUSH_KINDS)[number];

export type PushPreferences = Record<MutablePushKind, boolean>;

/** No row means push is on. */
const ALL_ON: PushPreferences = { announce: true, event: true, deadline: true };

async function fetchPushPreferences(
  memberId: string,
): Promise<PushPreferences> {
  const { data, error } = await supabase
    .from('notification_push_preferences')
    .select('kind, push_enabled')
    .eq('member_id', memberId);
  if (error) throw error;

  const preferences = { ...ALL_ON };
  for (const row of data ?? []) {
    if ((MUTABLE_PUSH_KINDS as readonly string[]).includes(row.kind)) {
      preferences[row.kind as MutablePushKind] = row.push_enabled;
    }
  }
  return preferences;
}

/**
 * The Member's per-kind push preferences, for every device they own. Each
 * switch writes one row through the self-only policies; the in-app
 * Notification list is never affected.
 */
export function usePushPreferences() {
  const { session } = useAuth();
  const memberId = session?.user.id;
  const queryClient = useQueryClient();
  const queryKey = keys.push.preferences(memberId);

  const query = useQuery({
    queryKey,
    queryFn: memberId ? () => fetchPushPreferences(memberId) : skipToken,
  });

  const mutation = useMutation({
    // One write at a time: every switch is held while a write is in flight
    // (`pending`), and the shared scope queues any call that still slips in,
    // so writes land in click order and a rollback never undoes a later one.
    scope: { id: `push-preferences-${memberId ?? 'signed-out'}` },
    mutationFn: async ({
      kind,
      enabled,
    }: {
      kind: MutablePushKind;
      enabled: boolean;
    }) => {
      if (!memberId) throw new Error('not_signed_in');
      const { error } = await supabase
        .from('notification_push_preferences')
        .upsert(
          { member_id: memberId, kind, push_enabled: enabled },
          { onConflict: 'member_id,kind' },
        );
      if (error) throw error;
    },
    // The switch moves at once; a refusal puts it back.
    onMutate: async ({ kind, enabled }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<PushPreferences>(queryKey);
      queryClient.setQueryData<PushPreferences>(queryKey, {
        ...(previous ?? ALL_ON),
        [kind]: enabled,
      });
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous)
        queryClient.setQueryData(queryKey, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  return {
    preferences: query.data ?? ALL_ON,
    /** The first read is still running. */
    loading: query.isLoading,
    /** A switch change is in flight; every switch waits for it. */
    pending: mutation.isPending,
    error:
      query.isError || mutation.isError
        ? (reasonCopy('push_preference_failed') ?? null)
        : null,
    setPreference: (kind: MutablePushKind, enabled: boolean) =>
      mutation.mutate({ kind, enabled }),
  };
}
