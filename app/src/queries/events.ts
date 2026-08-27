import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { keys } from './keys';
import type { Database } from '../lib/database.types';

export type EventRow = Database['public']['Tables']['events']['Row'];

const EVENT_FIELDS =
  'id, title, type, scope, starts_at, ends_at, location, dept_id, team_id';

/**
 * The upcoming events list.
 *
 * Visibility is handled by RLS on the backend. This hook just fetches
 * all events starting from today onwards, sorted ascending by starts_at.
 */
export function useUpcomingEvents() {
  return useQuery({
    queryKey: keys.events.upcoming(),
    queryFn: async () => {
      // Use local date string in YYYY-MM-DD format to match the date part of timestamp
      const today = new Date();
      const offset = today.getTimezoneOffset() * 60000;
      const localISOTime = (new Date(today.getTime() - offset)).toISOString().slice(0, 10);

      const { data, error } = await supabase
        .from('events')
        .select(EVENT_FIELDS)
        // Only fetch events that start today or in the future
        .gte('starts_at', localISOTime)
        .order('starts_at', { ascending: true });
        
      if (error) throw error;
      return data as EventRow[];
    },
  });
}
