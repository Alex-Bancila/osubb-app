import { useQuery } from '@tanstack/react-query';

import {
  bucharestDayKey,
  formatBucharestDay,
  formatBucharestTime,
} from '../lib/calendar-time';
import { useAuth } from '../lib/auth';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

const EVENT_FIELDS =
  'id, title, type, scope, dept_id, team_id, starts_at, ends_at, location, capacity, description';

type EventTableRow = Database['public']['Tables']['events']['Row'];
type EventRow = Pick<
  EventTableRow,
  | 'id'
  | 'title'
  | 'type'
  | 'scope'
  | 'dept_id'
  | 'team_id'
  | 'starts_at'
  | 'ends_at'
  | 'location'
  | 'capacity'
  | 'description'
>;

export type EventPresentation = {
  id: number;
  title: string;
  type: EventRow['type'];
  scope: EventRow['scope'];
  departmentId: string | null;
  teamId: string | null;
  startsAt: string;
  endsAt: string | null;
  dayKey: string;
  dayLabel: string;
  startTime: string;
  endTime: string | null;
  location: string | null;
  capacity: number | null;
  description: string | null;
};

/** Convert database naming and instants once, before any calendar UI sees it. */
export function toEventPresentation(row: EventRow): EventPresentation | null {
  if (!row.starts_at) return null;

  const dayKey = bucharestDayKey(row.starts_at);
  if (!dayKey) return null;

  return {
    id: row.id,
    title: row.title,
    type: row.type,
    scope: row.scope,
    departmentId: row.dept_id,
    teamId: row.team_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    dayKey,
    dayLabel: formatBucharestDay(row.starts_at),
    startTime: formatBucharestTime(row.starts_at),
    endTime: row.ends_at ? formatBucharestTime(row.ends_at) : null,
    location: row.location,
    capacity: row.capacity,
    description: row.description,
  };
}

/**
 * Upcoming means the start instant has not passed—not "today in Bucharest".
 * RLS remains the only visibility filter; the browser asks for no role/dept
 * branches and receives only the events this member may see.
 */
export async function fetchUpcomingEvents(
  now: Date = new Date(),
): Promise<EventPresentation[]> {
  const { data, error } = await supabase
    .from('events')
    .select(EVENT_FIELDS)
    .gte('starts_at', now.toISOString())
    .order('starts_at', { ascending: true });
  if (error) throw error;

  const rows: EventRow[] = data ?? [];
  return rows
    .map(toEventPresentation)
    .filter((event): event is EventPresentation => event !== null);
}

export function upcomingEventsQueryOptions(memberId: string) {
  return {
    queryKey: keys.events.upcoming(memberId),
    queryFn: () => fetchUpcomingEvents(),
    // The instant in `starts_at >= now()` moves continuously. Refetch whenever
    // this screen mounts or regains focus instead of treating yesterday's
    // upcoming list as fresh for the global 30-second cache window.
    staleTime: 0,
  } as const;
}

export function useUpcomingEvents() {
  const { session } = useAuth();
  const memberId = session?.user.id;

  return useQuery({
    ...upcomingEventsQueryOptions(memberId ?? ''),
    enabled: Boolean(memberId),
  });
}
