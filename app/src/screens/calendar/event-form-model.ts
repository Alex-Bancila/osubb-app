import type { Database } from '../../lib/database.types';
import {
  EVENT_MINIMUM_LEVELS,
  minimumLevelOptions,
} from '../../lib/minimum-level';

export type EventType = Database['public']['Enums']['event_type'];

export type EventFormGroup = {
  id: number;
  name: string;
  path: number[];
  minLevel: number;
  isOrganization: boolean;
};

/** An active Campaign an Event may carry (#691). */
export type EventFormCampaign = { id: number; name: string; group_id: number };

export type EventFormOptions = {
  groups: EventFormGroup[];
  groupNames: Array<{ id: number; name: string }>;
  /** Active Campaigns; `eventCampaignsFor` narrows them to the chosen Group. */
  campaigns: EventFormCampaign[];
  /**
   * Groups the viewer may publish an Announcement from (#909), the compose
   * sheet's own rule (`announcementOrigins`, the client copy of
   * `announcements_create`). Absent when editing: only a new Event offers
   * "Creează și un anunț".
   */
  announceGroupIds?: number[];
};

export type EventFormValues = {
  title: string;
  type: EventType;
  groupId: number | null;
  startsAt: string;
  endsAt: string;
  location: string;
  capacity: string;
  description: string;
  minLevel: number;
  campaignId: number | null;
  /**
   * **Toată ziua** (ruling R63). The two dates keep their times while it is
   * ticked, so unticking it gives the author's times back; ticked, the end's
   * day is the last day, inclusive.
   */
  allDay: boolean;
  /** The author ticked or unticked it: it never changes by itself again. */
  allDayTouched: boolean;
  /** "Creează și un anunț" (#909): unticked until the author ticks it. */
  announce: boolean;
};

export const emptyEventFormValues: EventFormValues = {
  title: '',
  type: 'sedinta',
  groupId: null,
  startsAt: '',
  endsAt: '',
  location: '',
  capacity: '',
  description: '',
  minLevel: 0,
  campaignId: null,
  allDay: false,
  allDayTouched: false,
  announce: false,
};

export type EventDraft = {
  title: string;
  type: EventType;
  groupId: number;
  /** For an all-day Event, 00:00 Bucharest on its first day. */
  startsAt: string;
  /** For an all-day Event, 00:00 Bucharest after its last day (exclusive). */
  endsAt: string | null;
  allDay: boolean;
  location: string | null;
  capacity: number | null;
  description: string | null;
  minLevel: number;
  campaignId: number | null;
  /** Publish the matching Announcement in the same call (#909). */
  announce: boolean;
};

/* ------------------------------------------------------------------------ */
/* Toată ziua (ruling R63)                                                   */
/* ------------------------------------------------------------------------ */

/** The times an all-day Event's dates get back when the box is unticked. */
export const ALL_DAY_UNTICK_START = '09:00';
export const ALL_DAY_UNTICK_END = '17:00';

/** `YYYY-MM-DD` `count` days away. Pure date arithmetic: DST cannot touch it. */
export function shiftDay(day: string, count: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

/**
 * The Bucharest day a form value's end falls on, as a calendar reads it: an
 * end at 00:00 closes the day before (a party until midnight is one day).
 */
export function endDayOf(endsAt: string): string {
  const day = endsAt.slice(0, 10);
  return endsAt.slice(11, 16) === '00:00' ? shiftDay(day, -1) : day;
}

/** The value with its day replaced, its time kept (or `time` when it has none). */
export function withDay(value: string, day: string, time: string): string {
  const kept = /T(\d{2}:\d{2})$/.exec(value)?.[1];
  return `${day}T${kept ?? time}`;
}

/**
 * The form after the author moves a date: when the end falls on another
 * Bucharest day than the start, **Toată ziua** ticks itself — unless the
 * author has ticked or unticked it before, whose choice is never undone. The
 * times stay in the values, so unticking it keeps them.
 */
export function withEventDates(
  values: EventFormValues,
  patch: Pick<Partial<EventFormValues>, 'startsAt' | 'endsAt'>,
): EventFormValues {
  const next = { ...values, ...patch };
  const spansDays =
    next.startsAt !== '' &&
    next.endsAt !== '' &&
    endDayOf(next.endsAt) > next.startsAt.slice(0, 10);
  if (!next.allDay && !next.allDayTouched && spansDays)
    return { ...next, allDay: true };
  return next;
}

/**
 * The author ticks or unticks **Toată ziua**: from now on it is theirs. A
 * ticked box needs a last day, so an empty end becomes the start's day — a
 * one-day all-day Event; the times stay, ready for an untick.
 */
export function withAllDay(
  values: EventFormValues,
  allDay: boolean,
  defaultEndTime: string,
): EventFormValues {
  const endsAt =
    allDay && values.endsAt === '' && values.startsAt !== ''
      ? withDay('', values.startsAt.slice(0, 10), defaultEndTime)
      : values.endsAt;
  return { ...values, allDay, allDayTouched: true, endsAt };
}

export const EVENT_TYPE_CHOICES: ReadonlyArray<{
  value: EventType;
  label: string;
}> = [
  { value: 'sedinta', label: 'Ședință' },
  { value: 'activitate', label: 'Activitate' },
  { value: 'call', label: 'Call' },
  { value: 'eveniment', label: 'Eveniment' },
  { value: 'deadline', label: 'Deadline' },
  { value: 'recrutare', label: 'Recrutare' },
];

/**
 * "Cine îl vede": the ladder rungs `events_min_level_ck` accepts (all six since R57), by Role name
 * (ruling R29b), from the Group's floor up to the actor's own level.
 */
export function minimumLevelChoices(
  groupFloor: number,
  actorLevel: number,
): Array<{ value: number; label: string }> {
  return minimumLevelOptions(
    EVENT_MINIMUM_LEVELS,
    (level) => level >= groupFloor && (actorLevel >= 9 || level <= actorLevel),
  ).map((rung) => ({ value: rung.level, label: rung.label }));
}

/**
 * Presentation-only pruning for a possibly stale token level. The command
 * reloads the actor and Group before writing; this only avoids offering a
 * combination the current session already knows cannot work.
 */
export function groupsAvailableAtLevel(
  options: EventFormOptions,
  actorLevel: number,
): EventFormGroup[] {
  return options.groups.filter(
    (group) => minimumLevelChoices(group.minLevel, actorLevel).length > 0,
  );
}

/**
 * **Campanie** options for an Event on this Group: the active Campaigns owned
 * by the Group or by a Group above it on its path — the rule
 * `private.validate_event_campaign` enforces (#691), and the one
 * `campaignsFor` applies to a Task's Origin. No Group, no Campaign.
 */
export function eventCampaignsFor(
  group: Pick<EventFormGroup, 'path'> | null | undefined,
  campaigns: readonly EventFormCampaign[],
): EventFormCampaign[] {
  return group
    ? campaigns.filter((campaign) => group.path.includes(campaign.group_id))
    : [];
}

/**
 * Whether "Creează și un anunț" may be offered for this Group (#909): the
 * viewer may publish from it. The Announcement copies the Event's Minimum
 * Level, so every Event may carry one. Before a Group is chosen it is offered
 * when any Group would allow it. Presentation only: `create_event` decides.
 */
export function mayAnnounceEvent(
  options: Pick<EventFormOptions, 'announceGroupIds'>,
  group: Pick<EventFormGroup, 'id'> | null,
): boolean {
  const ids = options.announceGroupIds ?? [];
  return group ? ids.includes(group.id) : ids.length > 0;
}
