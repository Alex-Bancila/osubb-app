import { skipToken, useQuery } from '@tanstack/react-query';

import {
  bucharestDayKey,
  bucharestLastDayKey,
  formatBucharestDay,
  formatBucharestTime,
} from '../lib/calendar-time';
import { useAuth } from '../lib/auth';
import type { Database } from '../lib/database.types';
import { approvalStatusOf, type ApprovalStatus } from './approvals';
import { supabase } from '../lib/supabase';
import { readAllRows } from './read-all';
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
  'id, title, type, group_id, campaign_id, starts_at, ends_at, all_day, location, capacity, description, min_level, created_by, cancelled_at, cancel_reason, approval_status, rejection_reason, group:groups(name, short, color, category, path, is_organization)';

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
  | 'min_level'
  | 'created_by'
  | 'cancelled_at'
  | 'cancel_reason'
> & {
  /** Optional so a row read before #691 still maps; absent means none. */
  campaign_id?: EventTableRow['campaign_id'];
  /** Optional so a row read before #1098 still maps; absent means timed. */
  all_day?: EventTableRow['all_day'];
  /** Optional so a row read before the approval flow still maps: approved. */
  approval_status?: EventTableRow['approval_status'];
  rejection_reason?: EventTableRow['rejection_reason'];
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
  /**
   * **Toată ziua** (ruling R63): stored from 00:00 Bucharest on the first day
   * to 00:00 Bucharest after the last, so `endsAt` is exclusive; no time is
   * shown for it anywhere.
   */
  allDay: boolean;
  /** The Bucharest day it starts on: the one day list it is under. */
  dayKey: string;
  /**
   * The last Bucharest day it touches — `dayKey` for most. An end exactly at
   * a midnight belongs to the day before it, so an all-day Event's last day
   * is the one before its exclusive end.
   */
  lastDayKey: string;
  /** It touches more than one day: the month grid draws it as one bar. */
  multiDay: boolean;
  dayLabel: string;
  startTime: string;
  endTime: string | null;
  location: string | null;
  capacity: number | null;
  description: string | null;
  /** "Cine îl vede": the Minimum Level, which the edit form starts from. */
  minLevel: number;
  /** The creator: an Organization Event is edited by them or by BC/Moderator. */
  createdBy: string | null;
  /** Set once the Event is cancelled (ADR-0008): the card says so, no RSVP. */
  cancelledAt: string | null;
  cancelReason: string | null;
  /**
   * A Cerere de aprobare (spec 2026-10-11): pending or rejected until BC
   * publishes it; approved for every row anyone else can read.
   */
  approvalStatus: ApprovalStatus;
  rejectionReason: string | null;
};

/** Convert database naming and instants once, before any calendar UI sees it. */
export function toEventPresentation(row: EventRow): EventPresentation | null {
  if (!row.starts_at) return null;

  const dayKey = bucharestDayKey(row.starts_at);
  if (!dayKey) return null;
  const lastDayKey = bucharestLastDayKey(dayKey, row.ends_at);

  return {
    id: row.id,
    title: row.title,
    type: row.type,
    groupId: row.group_id,
    group: row.group,
    campaignId: row.campaign_id ?? null,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    allDay: row.all_day ?? false,
    dayKey,
    lastDayKey,
    multiDay: lastDayKey !== dayKey,
    dayLabel: formatBucharestDay(row.starts_at),
    startTime: formatBucharestTime(row.starts_at),
    endTime: row.ends_at ? formatBucharestTime(row.ends_at) : null,
    location: row.location,
    capacity: row.capacity,
    description: row.description,
    minLevel: row.min_level,
    createdBy: row.created_by,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    approvalStatus: approvalStatusOf(row.approval_status),
    rejectionReason: row.rejection_reason ?? null,
  };
}

/**
 * A half-open window: `from` inclusive, `to` exclusive, both instants (the
 * Work Filter's `rangeBounds` turns its days into them). Either end may be
 * absent — no bound.
 */
export type EventRange = { from?: string; to?: string };

/**
 * Every Event that overlaps the window, oldest first: it starts before the
 * window ends, and starts in it or is still going when it opens (#1098, R63)
 * — a weekend that began on the last day of September is on October's grid.
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
  const rows: EventRow[] = await readAllRows((from, to) => {
    let query = supabase.from('events').select(EVENT_FIELDS);
    // Quoted: an instant's `:` and `.` are reserved in a PostgREST `or`.
    if (range.from)
      query = query.or(
        `starts_at.gte."${range.from}",ends_at.gt."${range.from}"`,
      );
    if (range.to) query = query.lt('starts_at', range.to);
    return query
      .order('starts_at', { ascending: true })
      .order('id')
      .range(from, to);
  });
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
