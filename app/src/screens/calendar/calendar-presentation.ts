import {
  Building2,
  Circle,
  Globe,
  Rocket,
  Users,
  type LucideIcon,
} from 'lucide-react';

import {
  bucharestDayKey,
  bucharestLastDayKey,
  formatBucharestShort,
  formatBucharestShortDay,
  formatBucharestTime,
} from '../../lib/calendar-time';
import { parsePositiveInt } from '../../lib/ids';
import {
  chosenGroupId,
  rangeBounds,
  type WorkFilterValue,
} from '../../lib/work-filter';
import type { CalendarTaskRow } from '../../queries/calendar-tasks';
import type {
  EventGroup,
  EventPresentation,
  EventRange,
} from '../../queries/events';
import { isMemberOf, type MyGroup } from '../../queries/my-groups';
import type { Group } from '../../queries/reference';
import {
  taskOrigin,
  taskStatusLabel,
  type TaskStatus,
} from '../tracker/task-presentation';

export type EventDayGroup = {
  dayKey: string;
  dayLabel: string;
  events: EventPresentation[];
};

const EVENT_TYPE_LABELS: Record<EventPresentation['type'], string> = {
  sedinta: 'Ședință',
  activitate: 'Activitate',
  call: 'Call',
  eveniment: 'Eveniment',
  deadline: 'Deadline',
  recrutare: 'Recrutare',
};

/**
 * `groups.category` is a presentation label and nothing else (ADR-0009) — which
 * is exactly what an icon is. No rule may branch on it; this map is allowed to.
 */
const GROUP_CATEGORY_ICONS: Record<string, LucideIcon> = {
  organization: Globe,
  department: Building2,
  team: Users,
  project: Rocket,
};

/** The Agendă: Events grouped by their Bucharest day, oldest first. */
export function groupEventsByDay(events: EventPresentation[]): EventDayGroup[] {
  const groups = new Map<string, EventDayGroup>();
  const chronological = [...events].sort(
    (left, right) =>
      Date.parse(left.startsAt) - Date.parse(right.startsAt) ||
      left.id - right.id,
  );

  for (const event of chronological) {
    const group = groups.get(event.dayKey);
    if (group) {
      group.events.push(event);
      continue;
    }

    groups.set(event.dayKey, {
      dayKey: event.dayKey,
      dayLabel: event.dayLabel,
      events: [event],
    });
  }

  return [...groups.values()];
}

export function eventTypeLabel(type: EventPresentation['type']): string {
  return EVENT_TYPE_LABELS[type];
}

/* ------------------------------------------------------------------------ */
/* All-day and multi-day Events (ruling R63)                                 */
/* ------------------------------------------------------------------------ */

type EventSpan = Pick<
  EventPresentation,
  'startsAt' | 'endsAt' | 'allDay' | 'dayKey' | 'lastDayKey' | 'multiDay'
>;

const UNTIL_DAY = new Intl.DateTimeFormat('ro-RO', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'short',
});

const UNTIL_DAY_WITH_YEAR = new Intl.DateTimeFormat('ro-RO', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** `duminică, 26 oct.` for a Bucharest day key; the year when not this one. */
function untilDayLabel(dayKey: string, now: Date): string {
  const sameYear =
    dayKey.slice(0, 4) === (bucharestDayKey(now) ?? '').slice(0, 4);
  return (sameYear ? UNTIL_DAY : UNTIL_DAY_WITH_YEAR).format(
    new Date(`${dayKey}T00:00:00Z`),
  );
}

/**
 * The time line of an Event's card: `18:00–20:00` for an evening,
 * `Toată ziua` for one all-day day, `Toată ziua · până duminică, 26 oct.` for
 * several, and both ends with their days for a timed Event that crosses
 * midnight — `vin., 23 oct., 18:00 → dum., 25 oct., 14:00`. An all-day Event
 * never shows a time.
 */
export function eventTimeLabel(
  event: EventSpan & Pick<EventPresentation, 'startTime' | 'endTime'>,
  now: Date = new Date(),
): string {
  if (event.allDay)
    return event.multiDay
      ? `Toată ziua · până ${untilDayLabel(event.lastDayKey, now)}`
      : 'Toată ziua';
  if (event.multiDay && event.endsAt)
    return `${formatBucharestShortDay(event.startsAt, now)}, ${event.startTime} → ${formatBucharestShortDay(event.endsAt, now)}, ${event.endTime ?? ''}`;
  return event.endTime
    ? `${event.startTime}–${event.endTime}`
    : event.startTime;
}

/**
 * An Event's day and time in one short line, away from the Calendar's day
 * headings (a Group's page): `lun., 5 oct. · 18:00`, `sâm., 24 oct. · Toată
 * ziua · până luni, 26 oct.`, or both ends of a timed Event over several days.
 */
export function eventWhenLine(
  event: {
    starts_at: string;
    ends_at?: string | null;
    all_day?: boolean | null;
  },
  now: Date = new Date(),
): string {
  const endsAt = event.ends_at ?? null;
  const dayKey = bucharestDayKey(event.starts_at) ?? '';
  const lastDayKey = bucharestLastDayKey(dayKey, endsAt);
  const span = {
    startsAt: event.starts_at,
    endsAt,
    allDay: event.all_day ?? false,
    dayKey,
    lastDayKey,
    multiDay: lastDayKey !== dayKey,
    startTime: formatBucharestTime(event.starts_at),
    endTime: endsAt ? formatBucharestTime(endsAt) : null,
  };
  if (span.allDay)
    return `${formatBucharestShortDay(event.starts_at, now)} · ${eventTimeLabel(span, now)}`;
  if (span.multiDay) return eventTimeLabel(span, now);
  return formatBucharestShort(event.starts_at, now);
}

/**
 * Whether an Event is behind us, so it takes no RSVP: a timed one-day Event
 * once it has started (ADR-0008), an all-day or several-day one only once it
 * has ended — a weekend trip is still answerable on its Saturday.
 */
export function eventIsPast(event: EventSpan, now: number): boolean {
  if ((event.allDay || event.multiDay) && event.endsAt)
    return Date.parse(event.endsAt) <= now;
  return Date.parse(event.startsAt) < now;
}

/** Whether an Event touches a Bucharest day: from its first day to its last. */
export function eventTouchesDay(
  event: Pick<EventPresentation, 'dayKey' | 'lastDayKey'>,
  dayKey: string,
): boolean {
  return event.dayKey <= dayKey && dayKey <= event.lastDayKey;
}

/** The icon beside an Event's Group, chosen by the Group's category. */
export function eventGroupIcon(event: EventPresentation): LucideIcon {
  if (!event.group) return Circle;
  return GROUP_CATEGORY_ICONS[event.group.category] ?? Circle;
}

/**
 * Whether an Event waits for BC's decision (spec 2026-10-11): pending and not
 * cancelled. A cancelled request is history the server will not decide
 * (`event_cancelled`, review I1), and `approval_requests()` leaves it out.
 */
export function awaitsDecision(
  event: Pick<EventPresentation, 'approvalStatus' | 'cancelledAt'>,
): boolean {
  return event.approvalStatus === 'pending' && event.cancelledAt === null;
}

/** The element the `?event=<id>` deep link scrolls to and focuses. */
export function eventCardId(eventId: number): string {
  return `event-${eventId}`;
}

/** `?event=<id>`: a positive whole Event id, or nothing. */
export function linkedEventId(value: string | null): number | null {
  return parsePositiveInt(value);
}

/** Neutral ink: a Group with no colour anywhere on its chain. */
const NEUTRAL = 'var(--ink-400)';

/**
 * A Group's colour: its own, else the nearest ancestor's that has one.
 *
 * Only Departments and the Organization carry one. `groups.color` is mirrored
 * from `departments.color` (Brand Book 2025) and `teams`/`projects` have no
 * colour column at all, so every Team and Project Group is `null` — walking up
 * is what keeps a Department Team in its Department's colour.
 *
 * `path` is root-first and ends in the Group's own id, so walking it backwards
 * is "nearest ancestor first".
 */
export function groupAccentColor(
  group: EventGroup | null | undefined,
  groups?: Map<number, Group>,
): string {
  if (!group) return NEUTRAL;
  if (group.color) return group.color;

  for (let index = group.path.length - 2; index >= 0; index -= 1) {
    const ancestorId = group.path[index];
    const ancestor =
      ancestorId === undefined ? undefined : groups?.get(ancestorId);
    if (ancestor?.color) return ancestor.color;
  }

  // Nothing on the chain has one. The Organization keeps its token so a native
  // Organization Group created without a colour is still OSUBB red.
  return group.is_organization ? 'var(--scope-org)' : NEUTRAL;
}

/** The Group colour of an Event, before the relevance rule is applied. */
export function eventAccentColor(
  event: EventPresentation,
  groups?: Map<number, Group>,
): string {
  return groupAccentColor(event.group, groups);
}

/**
 * Who an Event belongs to: the Group's **name** (ruling of 2026-09-28, B24),
 * never its category — "Festivalul Studențesc 2026", not "Proiect".
 *
 *  * `is_organization` — the one Group that *is* OSUBB reads "OSUBB", whatever
 *    its row is called, rather than the calendar recognising it by name;
 *  * the ancestor `path` — a Child Group adds its parent's name, so Echipa
 *    Aplicație under Diverse reads "Echipa Aplicație · Diverse". A parent that
 *    is the Organization Group adds nothing: every Group is OSUBB's.
 *
 * `groups` is the Groups this member may read; it is needed only to name the
 * parent of a Child Group, and an unreadable parent is simply left out.
 */
export function eventGroupLabel(
  event: EventPresentation,
  groups?: Map<number, Group>,
): string {
  const group = event.group;
  const name = group?.name.trim();
  // Either the Event names no Group at all, or it names one RLS withholds (an
  // archived Project's, say). Neither is worth an id on screen.
  if (!group || !name) return 'Grup';

  if (group.is_organization) return 'OSUBB';

  const parentId =
    group.path.length > 1 ? group.path[group.path.length - 2] : undefined;
  const parent = parentId === undefined ? undefined : groups?.get(parentId);
  const parentName = parent?.is_organization ? '' : parent?.name.trim();
  return parentName ? `${name} · ${parentName}` : name;
}

/* ------------------------------------------------------------------------ */
/* Relevance and colour (ruling R10, ADR-0008 §Relevance)                    */
/* ------------------------------------------------------------------------ */

/**
 * Grey for an Other OSUBB Event. Grey is never the only cue: the card names
 * the Event's Group (ruling of 2026-09-28 retired the "Alt eveniment OSUBB"
 * label).
 */
export const OTHER_EVENT_COLOR = 'var(--event-other)';

/**
 * The Groups whose Events are Relevant Events for this member: every Group on
 * the path of a Group they are a member of (`isMemberOf` — roster row or
 * Automatic Membership, never authority reached through an ancestor). A Child
 * Group's member is in its parent's Group Audience, so the parent's Events are
 * theirs; a Department member is not in its Child Team's (Wave 2 ruling D2).
 */
export function relevantGroupIds(mine: readonly MyGroup[]): Set<number> {
  const ids = new Set<number>();
  for (const group of mine)
    if (isMemberOf(group)) for (const id of group.path) ids.add(id);
  return ids;
}

export type EventRelevance = 'organization' | 'own' | 'going' | 'other';

/**
 * Which colour band an Event falls in: the Organization Group's (OSUBB red),
 * one of the member's own Groups' (the Group colour), an Other OSUBB Event the
 * member answered "Vin" to (the Group colour too), or any other readable Event
 * (grey, named by its Group like every other).
 */
export function eventRelevance(
  event: Pick<EventPresentation, 'id' | 'groupId' | 'group'>,
  relevant: ReadonlySet<number>,
  going: ReadonlySet<number>,
): EventRelevance {
  if (event.group?.is_organization) return 'organization';
  if (event.groupId !== null && relevant.has(event.groupId)) return 'own';
  if (going.has(event.id)) return 'going';
  return 'other';
}

export function relevanceColor(
  event: EventPresentation,
  relevance: EventRelevance,
  groups?: Map<number, Group>,
): string {
  if (relevance === 'organization') return 'var(--scope-org)';
  if (relevance === 'other') return OTHER_EVENT_COLOR;
  return eventAccentColor(event, groups);
}

/* ------------------------------------------------------------------------ */
/* The Work Filter over Events and Tasks                                     */
/* ------------------------------------------------------------------------ */

/**
 * The instants an Events read takes for an inclusive range of Bucharest days:
 * the first day's midnight, and the midnight after the last day (23 or 25
 * hours away across a DST change), exactly as the Work Filter bounds #677's
 * readers. An absent day is no bound.
 */
export function eventRangeForDays(from?: string, to?: string): EventRange {
  const bounds = rangeBounds({ from, to });
  const range: EventRange = {};
  if (bounds.p_from) range.from = bounds.p_from;
  if (bounds.p_to) range.to = bounds.p_to;
  return range;
}

/** Whether a Bucharest day falls in an inclusive day range; no end, no bound. */
export function dayInRange(
  dayKey: string,
  from: string | undefined,
  to: string | undefined,
): boolean {
  return (!from || dayKey >= from) && (!to || dayKey <= to);
}

/**
 * The Work Filter applied to Events: the chosen Group means it and every Group
 * below it (the Event's Group path contains it), the Campaign is the Event's
 * own label, and the range keeps an Event any of whose days fall in it — a
 * weekend that began in September is October's too (#1098).
 */
export function filterEvents(
  events: readonly EventPresentation[],
  filter: WorkFilterValue,
): EventPresentation[] {
  const groupId = chosenGroupId(filter);
  return events.filter(
    (event) =>
      (groupId === undefined ||
        (event.group?.path.includes(groupId) ?? event.groupId === groupId)) &&
      (filter.campaignId === undefined ||
        event.campaignId === filter.campaignId) &&
      (!filter.to || event.dayKey <= filter.to) &&
      (!filter.from || event.lastDayKey >= filter.from),
  );
}

export type CalendarTaskSource = 'own' | 'candidate' | 'managed';

/** A Task deadline as a Calendar chip and day row show it. */
export type CalendarTask = {
  id: number;
  title: string;
  dayKey: string;
  deadline: string;
  time: string;
  status: TaskStatus;
  statusLabel: string;
  groupLabel: string;
  color: string;
  path: readonly number[];
  groupId: number;
  campaignId: number | null;
  source: CalendarTaskSource;
};

function toCalendarTask(
  row: CalendarTaskRow,
  source: CalendarTaskSource,
  groups?: Map<number, Group>,
): CalendarTask | null {
  if (!row.deadline) return null;
  const dayKey = bucharestDayKey(row.deadline);
  if (!dayKey) return null;
  const origin = taskOrigin(row);
  return {
    id: row.id,
    title: row.title.trim() || 'Task fără titlu',
    dayKey,
    deadline: row.deadline,
    time: formatBucharestTime(row.deadline),
    status: row.status,
    statusLabel: taskStatusLabel(row.status),
    groupLabel: origin.label,
    // The Organization Group is always OSUBB red, as in the Tracker (R10).
    color: row.group?.is_organization
      ? 'var(--scope-org)'
      : groupAccentColor(row.group, groups),
    path: row.group?.path ?? [row.group_id],
    groupId: row.group_id,
    campaignId: row.campaign_id,
    source,
  };
}

/**
 * The Task chips of the Calendar: the member's own deadlines — Tasks they are
 * the Executor of (Taskurile mele's set) and Tasks they wait on as a pending
 * Candidate — plus, with **Taskurile gestionate** on, the Tasks they manage.
 * One chip per Task, own before candidate before managed; a Task with no
 * deadline has no day and no chip.
 */
export function calendarTasks(
  sources: {
    own?: readonly CalendarTaskRow[];
    candidate?: readonly CalendarTaskRow[];
    managed?: readonly CalendarTaskRow[] | null;
  },
  groups?: Map<number, Group>,
): CalendarTask[] {
  const tasks = new Map<number, CalendarTask>();
  const add = (
    rows: readonly CalendarTaskRow[] | null | undefined,
    source: CalendarTaskSource,
  ) => {
    for (const row of rows ?? []) {
      if (tasks.has(row.id)) continue;
      const task = toCalendarTask(row, source, groups);
      if (task) tasks.set(row.id, task);
    }
  };
  add(sources.own, 'own');
  add(sources.candidate, 'candidate');
  add(sources.managed, 'managed');
  return [...tasks.values()].sort(
    (a, b) =>
      Date.parse(a.deadline) - Date.parse(b.deadline) ||
      a.title.localeCompare(b.title, 'ro') ||
      a.id - b.id,
  );
}

/** The Work Filter applied to Task chips: Group path, Campaign, deadline day. */
export function filterTasks(
  tasks: readonly CalendarTask[],
  filter: WorkFilterValue,
): CalendarTask[] {
  const groupId = chosenGroupId(filter);
  return tasks.filter(
    (task) =>
      (groupId === undefined || task.path.includes(groupId)) &&
      (filter.campaignId === undefined ||
        task.campaignId === filter.campaignId) &&
      dayInRange(task.dayKey, filter.from, filter.to),
  );
}

/** Why a Task is on this member's Calendar, in words (never colour alone). */
export const TASK_SOURCE_LABELS: Record<CalendarTaskSource, string> = {
  own: 'Taskul tău',
  candidate: 'Candidatura ta',
  managed: 'Gestionat de tine',
};

/* ------------------------------------------------------------------------ */
/* The month grid                                                            */
/* ------------------------------------------------------------------------ */

/** `YYYY-MM`. */
export type MonthKey = string;

export type CalendarDay = {
  dayKey: string;
  dayNumber: number;
  inMonth: boolean;
  isToday: boolean;
};

function utcDay(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00Z`);
}

function toDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** A calendar day `delta` days away. Pure date arithmetic: DST cannot touch it. */
export function addDays(dayKey: string, delta: number): string {
  const date = utcDay(dayKey);
  date.setUTCDate(date.getUTCDate() + delta);
  return toDayKey(date);
}

export function monthOfDay(dayKey: string): MonthKey {
  return dayKey.slice(0, 7);
}

export function shiftMonth(month: MonthKey, delta: number): MonthKey {
  const date = utcDay(`${month}-01`);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return toDayKey(date).slice(0, 7);
}

/** The first and last calendar day of a month. */
export function monthBounds(month: MonthKey): { first: string; last: string } {
  return {
    first: `${month}-01`,
    last: addDays(`${shiftMonth(month, 1)}-01`, -1),
  };
}

const MONTH_LABEL = new Intl.DateTimeFormat('ro-RO', {
  timeZone: 'UTC',
  month: 'long',
  year: 'numeric',
});

const DAY_LABEL = new Intl.DateTimeFormat('ro-RO', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** `octombrie 2026`. */
export function monthLabel(month: MonthKey): string {
  return MONTH_LABEL.format(utcDay(`${month}-01`));
}

/** `luni, 26 octombrie 2026` for a Bucharest day key. */
export function dayKeyLabel(dayKey: string): string {
  return DAY_LABEL.format(utcDay(dayKey));
}

const WEEKDAY_LABEL = new Intl.DateTimeFormat('ro-RO', {
  timeZone: 'UTC',
  weekday: 'long',
});

const DATE_LABEL = new Intl.DateTimeFormat('ro-RO', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/**
 * The selected day's header (C1): the weekday as the eyebrow and the date as
 * the title — `{ weekday: 'luni', date: '26 octombrie 2026' }`.
 */
export function dayKeyHeading(dayKey: string): {
  weekday: string;
  date: string;
} {
  const day = utcDay(dayKey);
  return { weekday: WEEKDAY_LABEL.format(day), date: DATE_LABEL.format(day) };
}

/** Monday-first column headings. */
export const WEEKDAYS = [
  { short: 'L', long: 'luni' },
  { short: 'Ma', long: 'marți' },
  { short: 'Mi', long: 'miercuri' },
  { short: 'J', long: 'joi' },
  { short: 'V', long: 'vineri' },
  { short: 'S', long: 'sâmbătă' },
  { short: 'D', long: 'duminică' },
] as const;

/**
 * The weeks of a month as the grid draws them: Monday first, padded with the
 * neighbouring months' days to whole weeks. Day keys are Bucharest calendar
 * days (`calendar-time.ts` puts every Event and deadline on one), so a DST
 * change inside the month moves no day.
 */
export function buildMonthGrid(
  month: MonthKey,
  todayKey: string,
): CalendarDay[][] {
  const { first, last } = monthBounds(month);
  // getUTCDay: 0 = Sunday; Monday-first makes Sunday the 7th column.
  const lead = (utcDay(first).getUTCDay() + 6) % 7;
  const trail = 6 - ((utcDay(last).getUTCDay() + 6) % 7);
  const end = addDays(last, trail);
  const weeks: CalendarDay[][] = [];
  let week: CalendarDay[] = [];
  for (let day = addDays(first, -lead); day <= end; day = addDays(day, 1)) {
    week.push({
      dayKey: day,
      dayNumber: Number(day.slice(8, 10)),
      inMonth: monthOfDay(day) === month,
      isToday: day === todayKey,
    });
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  return weeks;
}

/** The first and last day the grid shows (neighbouring months included). */
export function gridBounds(weeks: CalendarDay[][]): {
  first: string;
  last: string;
} {
  return {
    first: weeks[0]?.[0]?.dayKey ?? '',
    last: weeks.at(-1)?.at(-1)?.dayKey ?? '',
  };
}

export type CalendarDayItems = {
  events: EventPresentation[];
  tasks: CalendarTask[];
};

/**
 * Events (chronological) and Task chips, by Bucharest day. An Event is on
 * every day it touches (#1098, R63), so a day lists — and counts — the
 * weekend it is part of, not only the Events that start on it.
 */
export function itemsByDay(
  events: readonly EventPresentation[],
  tasks: readonly CalendarTask[],
): Map<string, CalendarDayItems> {
  const days = new Map<string, CalendarDayItems>();
  const at = (dayKey: string) => {
    let items = days.get(dayKey);
    if (!items) {
      items = { events: [], tasks: [] };
      days.set(dayKey, items);
    }
    return items;
  };
  for (const day of groupEventsByDay([...events]))
    for (const event of day.events) {
      const last =
        event.lastDayKey > event.dayKey ? event.lastDayKey : event.dayKey;
      for (let key = event.dayKey; key <= last; key = addDays(key, 1))
        at(key).events.push(event);
    }
  for (const items of days.values())
    items.events.sort(
      (left, right) =>
        Date.parse(left.startsAt) - Date.parse(right.startsAt) ||
        left.id - right.id,
    );
  for (const task of tasks) at(task.dayKey).tasks.push(task);
  return days;
}

/**
 * One week row's piece of a several-day Event (#1098, R63): the month grid
 * draws it as one bar from `startColumn` over `span` days, in its `lane`
 * (0 is the top). `continuesBefore` / `continuesAfter` say the Event goes on
 * past the row's edge — into the week before or after, or off the grid.
 */
export type WeekBar = {
  event: EventPresentation;
  lane: number;
  startColumn: number;
  span: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
};

/**
 * The several-day Events of one week row, laid out in lanes: earliest first,
 * a longer bar before a shorter one starting the same day, each in the
 * lowest lane free over all its days, so overlapping bars stack and never
 * collide. Clamped to the row: the month's grid is its rows, so a bar never
 * leaves the visible days.
 */
export function layoutWeekBars(
  week: readonly CalendarDay[],
  events: readonly EventPresentation[],
): WeekBar[] {
  const first = week[0]?.dayKey;
  const last = week.at(-1)?.dayKey;
  if (!first || !last) return [];
  const column = (dayKey: string) =>
    week.findIndex((day) => day.dayKey === dayKey);
  const pieces = events
    .filter(
      (event) =>
        event.multiDay && event.dayKey <= last && event.lastDayKey >= first,
    )
    .map((event) => {
      const startColumn = column(event.dayKey < first ? first : event.dayKey);
      const endColumn = column(
        event.lastDayKey > last ? last : event.lastDayKey,
      );
      return {
        event,
        lane: 0,
        startColumn,
        span: endColumn - startColumn + 1,
        continuesBefore: event.dayKey < first,
        continuesAfter: event.lastDayKey > last,
      };
    })
    .sort(
      (a, b) =>
        a.startColumn - b.startColumn ||
        b.span - a.span ||
        Date.parse(a.event.startsAt) - Date.parse(b.event.startsAt) ||
        a.event.id - b.event.id,
    );
  // taken[lane][column]: whether a bar already sits there.
  const taken: boolean[][] = [];
  for (const piece of pieces) {
    let lane = 0;
    const free = (row: boolean[] | undefined) =>
      !row ||
      !row
        .slice(piece.startColumn, piece.startColumn + piece.span)
        .some(Boolean);
    while (!free(taken[lane])) lane += 1;
    const row = (taken[lane] ??= []);
    for (let index = 0; index < piece.span; index += 1)
      row[piece.startColumn + index] = true;
    piece.lane = lane;
  }
  return pieces;
}

/**
 * What one day cell of the month grid draws (#1098, R63), within `limit`
 * lines: its bar lanes from the top — a lane the day has no bar in, below
 * one it has, is left empty so every bar stays level along its row — then
 * as many of its own chips as still fit; whatever is left, bars in a lane
 * past the limit included, is the "+N".
 */
export function dayCellLayout(
  column: number,
  bars: readonly WeekBar[],
  chipCount: number,
  limit: number,
): { lanes: Array<WeekBar | null>; chipsShown: number; overflow: number } {
  const here = bars.filter(
    (bar) => bar.startColumn <= column && column < bar.startColumn + bar.span,
  );
  const visible = here.filter((bar) => bar.lane < limit);
  const depth = visible.reduce((most, bar) => Math.max(most, bar.lane + 1), 0);
  const lanes = Array.from(
    { length: depth },
    (_, lane) => visible.find((bar) => bar.lane === lane) ?? null,
  );
  const chipsShown = Math.max(0, Math.min(chipCount, limit - depth));
  return {
    lanes,
    chipsShown,
    overflow: here.length - visible.length + (chipCount - chipsShown),
  };
}

/** Romanian counted nouns: 1 eveniment, 2 evenimente, 20 de evenimente. */
export function countLabel(count: number, one: string, many: string): string {
  if (count === 1) return `1 ${one}`;
  const rest = count % 100;
  return count === 0 || (rest >= 1 && rest <= 19)
    ? `${count} ${many}`
    : `${count} de ${many}`;
}

/** What a day button says to a screen reader: the day and what it holds. */
export function daySummary(dayKey: string, items?: CalendarDayItems): string {
  const parts: string[] = [];
  if (items?.events.length)
    parts.push(countLabel(items.events.length, 'eveniment', 'evenimente'));
  if (items?.tasks.length)
    parts.push(
      countLabel(items.tasks.length, 'termen de task', 'termene de task'),
    );
  const label = dayKeyLabel(dayKey);
  return parts.length ? `${label}: ${parts.join(', ')}` : label;
}
