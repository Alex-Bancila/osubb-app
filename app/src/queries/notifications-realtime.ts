import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { signalMembershipChange } from '../lib/membership-signal';
import { keys } from './keys';

/** Realtime only signals a refetch. Row contents always come through RLS. */
export function useNotificationRealtime(memberId?: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!memberId) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    // Pull the Realtime client path only after the member shell mounts. This
    // keeps its SDK code out of the entry bundle and the PWA precache budget.
    void import('./notifications-realtime-channel')
      .then(({ subscribe }) => {
        if (!active) return;
        unsubscribe = subscribe(memberId, (change) => {
          if (!active) return;
          // A system Notification is the database telling this Member that
          // their role, level or Group standing changed (#959): the session
          // must be refreshed so the Organization Claims follow. The hint
          // only chooses to refresh; a wrong one costs a refresh, a missed
          // one waits for the focus (#598) or expiry backstop.
          if (change?.event === 'INSERT' && change.kind === 'system') {
            signalMembershipChange();
          }
          void queryClient.invalidateQueries({
            queryKey: keys.notifications.list(memberId),
          });
          void queryClient.invalidateQueries({
            queryKey: keys.notifications.unread(memberId),
          });
          void queryClient.invalidateQueries({
            queryKey: keys.notifications.subjects(memberId),
          });
          // #68 fans every Announcement out as a notification. The signal
          // carries no row (never read payloads), so any change refreshes the
          // Anunțuri badge, and the feed if it is on screen, to match it.
          void queryClient.invalidateQueries({
            queryKey: keys.announcements.unread(memberId),
          });
          void queryClient.invalidateQueries({
            queryKey: keys.announcements.feed(memberId),
          });
        });
      })
      .catch(() => undefined);

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [memberId, queryClient]);
}
