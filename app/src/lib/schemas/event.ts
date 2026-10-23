import { z } from 'zod';
import { bucharestDayKey, bucharestWallTimeToIso } from '../calendar-time';
import { EVENT_MINIMUM_LEVELS } from '../minimum-level';
import {
  EVENT_TYPE_CHOICES,
  eventCampaignsFor,
  mayAnnounceEvent,
  shiftDay,
  type EventDraft,
  type EventFormOptions,
  type EventFormValues,
  type EventType,
} from '../../screens/calendar/event-form-model';
import { optionalFormattedText, optionalText, requiredText } from './text';

const EVENT_TYPES: readonly string[] = EVENT_TYPE_CHOICES.map(
  (choice) => choice.value,
);

/**
 * An Event, as `create_event` / `update_event` accept it (#673, ruling R8):
 * title 3–120 characters, a Formatted Text description of at most 2000
 * visible and 4000 stored characters (ruling R60), a start not in the past
 * on creation, an end after the start, capacity 1–1000, and a Minimum Level
 * between the Group's and the actor's own. Wall-clock times are read in
 * Romania, as the form shows them.
 */
export function eventSchema(
  options: EventFormOptions,
  actorLevel: number,
  {
    creating = true,
    now = () => new Date(),
  }: { creating?: boolean; now?: () => Date } = {},
) {
  return z
    .object({
      title: requiredText({
        required: 'invalid_event_title',
        min: 3,
        tooShort: 'title_too_short',
        max: 120,
        tooLong: 'title_too_long',
      }),
      type: z.string(),
      groupId: z.number().nullable(),
      startsAt: z.string(),
      endsAt: z.string(),
      // Security pass 2026-09-27: events_location_length_ck (at most 200).
      location: optionalText({ max: 200, tooLong: 'location_too_long' }),
      capacity: z.string(),
      description: optionalFormattedText({ tooLong: 'description_too_long' }),
      minLevel: z.number(),
      campaignId: z.number().nullable(),
      allDay: z.boolean(),
      allDayTouched: z.boolean(),
      announce: z.boolean(),
    })
    .superRefine((values, ctx) => {
      const issue = (path: keyof EventFormValues, message: string) =>
        ctx.addIssue({ code: 'custom', path: [path], message });
      if (!EVENT_TYPES.includes(values.type))
        issue('type', 'invalid_event_type');
      const group = options.groups.find((item) => item.id === values.groupId);
      if (!group) issue('groupId', 'event_group_required');

      if (values.allDay) {
        // #1098 (R63): days only, the last one inclusive and required; the
        // start is in the past only from the day after (today's may begin).
        const first = values.startsAt.slice(0, 10);
        const last = values.endsAt.slice(0, 10);
        if (!first) issue('startsAt', 'all_day_start_required');
        else if (creating && first < (bucharestDayKey(now()) ?? ''))
          issue('startsAt', 'starts_at_in_past');
        if (!last) issue('endsAt', 'all_day_end_required');
        else if (first && last < first) issue('endsAt', 'all_day_interval');
      } else {
        const startsAt = values.startsAt
          ? bucharestWallTimeToIso(values.startsAt)
          : null;
        if (!values.startsAt) issue('startsAt', 'starts_at_required');
        else if (!startsAt) issue('startsAt', 'starts_at_invalid');
        else if (creating && Date.parse(startsAt) < now().getTime())
          issue('startsAt', 'starts_at_in_past');
        const endsAt = values.endsAt
          ? bucharestWallTimeToIso(values.endsAt)
          : null;
        if (values.endsAt && !endsAt) issue('endsAt', 'ends_at_invalid');
        else if (
          endsAt &&
          startsAt &&
          Date.parse(endsAt) <= Date.parse(startsAt)
        )
          issue('endsAt', 'invalid_event_interval');
      }

      const capacity = values.capacity.trim();
      if (capacity) {
        const count = Number(capacity);
        if (!Number.isInteger(count) || count < 1 || count > 1000)
          issue('capacity', 'invalid_event_capacity');
      }

      if (!EVENT_MINIMUM_LEVELS.includes(values.minLevel))
        issue('minLevel', 'invalid_event_min_level');
      else if (group && values.minLevel < group.minLevel)
        issue('minLevel', 'event_min_level_below_group');
      else if (actorLevel < 9 && values.minLevel > actorLevel)
        issue('minLevel', 'event_min_level_above_actor');

      // #691: a Campaign owned on the Event Group's path, and active — the
      // server's `invalid_campaign`, said before the round trip.
      if (
        values.campaignId !== null &&
        !eventCampaignsFor(group, options.campaigns).some(
          (campaign) => campaign.id === values.campaignId,
        )
      )
        issue('campaignId', 'invalid_campaign');
    })
    .transform((values): EventDraft => ({
      title: values.title,
      type: values.type as EventType,
      groupId: values.groupId ?? 0,
      ...eventBounds(values),
      allDay: values.allDay,
      location: values.location,
      capacity: values.capacity.trim() ? Number(values.capacity) : null,
      description: values.description,
      minLevel: values.minLevel,
      campaignId: values.campaignId,
      // #909: only a new Event, and only where the box is offered and enabled.
      announce:
        creating &&
        values.announce &&
        values.groupId !== null &&
        mayAnnounceEvent(
          options,
          options.groups.find((item) => item.id === values.groupId) ?? null,
        ),
    }));
}

/**
 * The instants the commands store. A timed Event's wall-clock values are read
 * in Romania. An all-day one (#1098, ruling R63) runs from 00:00 Bucharest on
 * its first day to 00:00 Bucharest after its last, which the form shows
 * inclusive — so the end is the day after the last one, at midnight, a day
 * that lasts 23 or 25 hours across a DST change.
 */
export function eventBounds(
  values: Pick<EventFormValues, 'startsAt' | 'endsAt' | 'allDay'>,
): { startsAt: string; endsAt: string | null } {
  if (values.allDay) {
    const first = values.startsAt.slice(0, 10);
    const last = values.endsAt.slice(0, 10);
    return {
      startsAt: bucharestWallTimeToIso(`${first}T00:00`) ?? '',
      endsAt: last
        ? bucharestWallTimeToIso(`${shiftDay(last, 1)}T00:00`)
        : null,
    };
  }
  return {
    startsAt: bucharestWallTimeToIso(values.startsAt) ?? '',
    endsAt: values.endsAt ? bucharestWallTimeToIso(values.endsAt) : null,
  };
}

/** Where each reason an Event command (or this schema) raises is shown. */
export const fieldForReason: Readonly<Record<string, keyof EventFormValues>> = {
  invalid_event_title: 'title',
  title_too_short: 'title',
  title_too_long: 'title',
  description_too_long: 'description',
  location_too_long: 'location',
  invalid_event_type: 'type',
  event_group_required: 'groupId',
  starts_at_required: 'startsAt',
  starts_at_invalid: 'startsAt',
  starts_at_in_past: 'startsAt',
  ends_at_invalid: 'endsAt',
  invalid_event_interval: 'endsAt',
  all_day_start_required: 'startsAt',
  all_day_end_required: 'endsAt',
  all_day_interval: 'endsAt',
  invalid_all_day_bounds: 'endsAt',
  invalid_event_capacity: 'capacity',
  invalid_event_min_level: 'minLevel',
  event_min_level_below_group: 'minLevel',
  event_min_level_above_actor: 'minLevel',
  invalid_campaign: 'campaignId',
};
