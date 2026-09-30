import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';

type NotificationRow = Database['public']['Tables']['notifications']['Row'];

/**
 * What a Realtime message says about a Notification row, and no more. `kind`
 * is a hint that decides which caches to refresh (#959) — nothing is ever
 * rendered from it; row contents always come through RLS.
 */
export type NotificationChange = {
  event: RealtimePostgresChangesPayload<NotificationRow>['eventType'];
  /** The inserted row's kind; null for updates and deletes. */
  kind: NotificationRow['kind'] | null;
};

function describe(
  payload: RealtimePostgresChangesPayload<NotificationRow>,
): NotificationChange {
  const kind =
    payload.eventType === 'INSERT' && typeof payload.new.kind === 'string'
      ? payload.new.kind
      : null;
  return { event: payload.eventType, kind };
}

// A fresh topic per subscription prevents an asynchronous unsubscribe from
// removing its replacement during a quick sign-out/sign-in or remount.
let nextChannelId = 0;

export function subscribe(
  memberId: string,
  onChange: (change?: NotificationChange) => void,
) {
  const channel = supabase
    .channel(`notifications:${memberId}:${++nextChannelId}`)
    .on<NotificationRow>(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `member_id=eq.${memberId}`,
      },
      (payload) => onChange(payload ? describe(payload) : undefined),
    )
    .subscribe((status) => {
      // A reconnect may have missed rows; refetch once the stream is live.
      if (status === 'SUBSCRIBED') onChange();
    });

  return () => {
    void supabase.removeChannel(channel);
  };
}
