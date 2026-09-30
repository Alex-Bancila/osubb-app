import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

/** The topic the database publishes on (#961, migration 20260930180000). */
const TOPIC = 'org:changes';

export type LiveChangeHandlers = {
  /** A statement changed rows of this table. Never a row: only its name. */
  onChange: (table: string) => void;
  /** The stream is live again after having been live: signals may have been missed. */
  onResubscribe: () => void;
};

// Realtime keys channels by topic, and the topic is fixed by the receive
// policy, so a quick sign-out/sign-in must not join before the previous
// leave has completed: each join waits for the last leave.
let closing: Promise<unknown> = Promise.resolve();

export function subscribe({ onChange, onResubscribe }: LiveChangeHandlers) {
  let cancelled = false;
  let channel: RealtimeChannel | undefined;
  let joinedBefore = false;

  void closing.then(() => {
    if (cancelled) return;
    channel = supabase
      .channel(TOPIC, { config: { private: true } })
      .on('broadcast', { event: 'change' }, (message) => {
        const table = (message as { payload?: { table?: unknown } } | undefined)
          ?.payload?.table;
        if (typeof table === 'string') onChange(table);
      })
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED') return;
        if (joinedBefore) onResubscribe();
        joinedBefore = true;
      });
  });

  return () => {
    cancelled = true;
    if (channel) {
      closing = Promise.resolve(supabase.removeChannel(channel)).catch(
        () => undefined,
      );
    }
  };
}
