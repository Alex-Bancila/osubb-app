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

/**
 * An Event names its owning Group (ADR-0009), and the Group carries everything
 * the calendar needs to describe it — so the row is embedded rather than looked
 * up: one request, and the Group a member may not read simply arrives as null
 * instead of as a dangling id.
 */
// One string literal, not a concatenation: supabase-js parses this at the type
// level to give `data` its shape, and a `+` defeats that.
const EVENT_FIELDS =
  'id, title, type, group_id, starts_at, ends_at, location, capacity, description, group:groups(name, short, color, category, path, is_organization)';

type EventTableRow = Database['public']['Tables']['events']['Row'];
type GroupRow = Database['public']['Tables']['groups']['Row'];

/** The owning Group as the calendar sees it. */
export type EventGroup = Pick<
  GroupRow,
  'name' | 'short' | 'color' | 'category' | 'path' | 'is_organization'
>;

type EventRow = Pick<
  EventTableRow,
  | 'id'
  | 'title'
  | 'type'
  | 'group_id'
  | 'starts_at'
  | 'ends_at'
  | 'location'
  | 'capacity'
  | 'description'
> & { group: EventGroup | null };

export type EventPresentation = {
  id: number;
  title: string;
  type: EventRow['type'];
  groupId: number | null;
  /** Null when the Event names no Group, or names one RLS keeps from this member. */
  group: EventGroup | null;
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
    groupId: row.group_id,
    group: row.group,
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
 *
 * Project Events are no longer filtered out here. `events_read` is the whole
 * visibility rule (Minimum Level, ADR-0008 as amended by ADR-0009): a member
 * who may read a Project Event is a member the calendar should show it to, and
 * the old `scope <> 'project'` filter hid it from them for no reason — it was a
 * stand-in from before `scope` stopped being the visibility model.
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
