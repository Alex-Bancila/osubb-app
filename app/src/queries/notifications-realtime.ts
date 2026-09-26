import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
        unsubscribe = subscribe(memberId, () => {
          if (!active) return;
          void queryClient.invalidateQueries({
            queryKey: keys.notifications.list(memberId),
          });
          void queryClient.invalidateQueries({
            queryKey: keys.notifications.unread(memberId),
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
