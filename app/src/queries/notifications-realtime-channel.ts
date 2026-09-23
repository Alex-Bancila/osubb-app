import { supabase } from '../lib/supabase';

// A fresh topic per subscription prevents an asynchronous unsubscribe from
// removing its replacement during a quick sign-out/sign-in or remount.
let nextChannelId = 0;

export function subscribe(memberId: string, onChange: () => void) {
  const channel = supabase
    .channel(`notifications:${memberId}:${++nextChannelId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `member_id=eq.${memberId}`,
      },
      onChange,
    )
    .subscribe((status) => {
      // A reconnect may have missed rows; refetch once the stream is live.
      if (status === 'SUBSCRIBED') onChange();
    });

  return () => {
    void supabase.removeChannel(channel);
  };
}
