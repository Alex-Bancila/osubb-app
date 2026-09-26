import { skipToken, useQuery } from '@tanstack/react-query';

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
  'id, title, type, group_id, campaign_id, starts_at, ends_at, location, capacity, description, group:groups(name, short, color, category, path, is_organization)';

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
> & {
  /** Optional so a row read before #691 still maps; absent means none. */
  campaign_id?: EventTableRow['campaign_id'];
  group: EventGroup | null;
};

export type EventPresentation = {
  id: number;
  title: string;
  type: EventRow['type'];
  groupId: number | null;
  /** Null when the Event names no Group, or names one RLS keeps from this member. */
  group: EventGroup | null;
  /** The Event's Campaign label (#691), or null. */
  campaignId: number | null;
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
    campaignId: row.campaign_id ?? null,
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
 * A half-open window on `starts_at`: `from` inclusive, `to` exclusive, both
 * instants (the Work Filter's `rangeBounds` turns its days into them). Either
 * end may be absent — no bound.
 */
export type EventRange = { from?: string; to?: string };

/**
 * Every Event whose start falls in the window, oldest first.
 *
 * There is no `now` floor any more (#691, ADR-0008 amended 2026-09-23): past
 * Events are readable, and `events_read` (Minimum Level) is the whole
 * visibility rule — the browser asks for no role or Group branch and receives
 * exactly the Events this member may see. The Calendar's "upcoming" default is
 * a window that starts at today's Bucharest midnight, which the caller passes.
 */
export async function fetchEventsInRange(
  range: EventRange,
): Promise<EventPresentation[]> {
  let query = supabase.from('events').select(EVENT_FIELDS);
  if (range.from) query = query.gte('starts_at', range.from);
  if (range.to) query = query.lt('starts_at', range.to);
  const { data, error } = await query.order('starts_at', { ascending: true });
  if (error) throw error;

  const rows: EventRow[] = data ?? [];
  return rows
    .map(toEventPresentation)
    .filter((event): event is EventPresentation => event !== null);
}

export function eventsRangeQueryOptions(memberId: string, range: EventRange) {
  return {
    queryKey: keys.events.range(memberId, range),
    queryFn: () => fetchEventsInRange(range),
  } as const;
}

/** The Calendar's read (and Acasă's, #700). `null` waits: nothing is sent. */
export function useEventsInRange(range: EventRange | null) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.events.range(memberId ?? '', range ?? {}),
    queryFn: memberId && range ? () => fetchEventsInRange(range) : skipToken,
  });
}

/**
 * One Event by id, for the `?event=<id>` deep link: null when it does not
 * exist or RLS keeps it from this member — the two are indistinguishable, and
 * the Calendar says the same thing about both.
 */
export async function fetchEvent(
  eventId: number,
): Promise<EventPresentation | null> {
  const { data, error } = await supabase
    .from('events')
    .select(EVENT_FIELDS)
    .eq('id', eventId)
    .maybeSingle();
  if (error) throw error;
  return data ? toEventPresentation(data as EventRow) : null;
}

export function useEvent(eventId: number | null) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.events.detail(eventId ?? 0, memberId ?? ''),
    queryFn:
      memberId && eventId !== null ? () => fetchEvent(eventId) : skipToken,
  });
}
