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
        });
      })
      .catch(() => undefined);

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [memberId, queryClient]);
}
