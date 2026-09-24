import {
  Building2,
  Circle,
  Globe,
  Rocket,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { bucharestDayKey, formatBucharestTime } from '../../lib/calendar-time';
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

/** The icon beside an Event's Group, chosen by the Group's category. */
export function eventGroupIcon(event: EventPresentation): LucideIcon {
  if (!event.group) return Circle;
  return GROUP_CATEGORY_ICONS[event.group.category] ?? Circle;
}

/** The element the `?event=<id>` deep link scrolls to and focuses. */
export function eventCardId(eventId: number): string {
  return `event-${eventId}`;
}

/** `?event=<id>`: a positive whole Event id, or nothing. */
export function linkedEventId(value: string | null): number | null {
  if (!value || !/^[1-9][0-9]*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
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
 * Who an Event belongs to, in the words a member uses.
 *
 * Three things decide it, all of them on the Group itself:
 *
 *  * `is_organization` — the one Group that *is* OSUBB says so, rather than the
 *    calendar recognising it by name or by a legacy id;
 *  * the ancestor `path` — a Group with a parent is somebody's Child Group, so a
 *    Department Team reads "Echipă · Educațional" while an Independent Team,
 *    which has no parent, is just "Echipă";
 *  * `category`, for the noun.
 *
 * `groups` is the Groups this member may read; it is needed only to name the
 * parent of a Child Group.
 */
export function eventGroupLabel(
  event: EventPresentation,
  groups?: Map<number, Group>,
): string {
  const group = event.group;
  // Either the Event names no Group at all, or it names one RLS withholds (an
  // archived Project's, say). Neither is worth an id on screen.
  if (!group) return 'Grup';

  if (group.is_organization) return 'OSUBB';

  if (group.category === 'team') {
    const parentId =
      group.path.length > 1 ? group.path[group.path.length - 2] : undefined;
    const parent = parentId === undefined ? undefined : groups?.get(parentId);
    return parent ? `Echipă · ${parent.name}` : 'Echipă';
  }

  if (group.category === 'project') return 'Proiect';

  return group.name;
}

/* ------------------------------------------------------------------------ */
/* Relevance and colour (ruling R10, ADR-0008 §Relevance)                    */
/* ------------------------------------------------------------------------ */

/** The label an Other OSUBB Event carries, so grey is never the only cue. */
export const OTHER_EVENT_LABEL = 'Alt eveniment OSUBB';

/** Grey for an Other OSUBB Event. */
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
 * (grey, labelled **Alt eveniment OSUBB**).
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
 * own label, and the range reads the Event's start day.
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
      dayInRange(event.dayKey, filter.from, filter.to),
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

/** Events (chronological) and Task chips, by Bucharest day. */
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
    at(day.dayKey).events.push(...day.events);
  for (const task of tasks) at(task.dayKey).tasks.push(task);
  return days;
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
