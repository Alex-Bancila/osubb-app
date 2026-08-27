import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

const EVENT_FIELDS =
  'id, title, type, scope, capacity, description, location, starts_at, ends_at, dept_id, team_id, created_by, has_qr';

/**
 * Fetch upcoming events visible to the current user.
 * We rely on Row Level Security (RLS) policies defined in the database
 * to enforce visibility rules (e.g., 'recrut demo login sees org + call/recrutare + its recruit-team events only').
 */
export function useUpcomingEvents() {
  return useQuery({
    queryKey: keys.events.upcoming(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('events')
        .select(EVENT_FIELDS)
        // Ensure we fetch events that haven't ended yet
        .gte('ends_at', new Date().toISOString())
        .order('starts_at', { ascending: true });

      if (error) throw error;
      return data;
    },
  });
}
