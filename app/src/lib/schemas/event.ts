import { z } from 'zod';
import { bucharestWallTimeToIso } from '../calendar-time';
import { emptyToNull, trimText } from '../normalize';
import {
  EVENT_TYPE_CHOICES,
  type EventDraft,
  type EventFormOptions,
  type EventFormValues,
  type EventType,
} from '../../screens/calendar/event-form-model';
import { optionalText, requiredText } from './text';

const EVENT_TYPES: readonly string[] = EVENT_TYPE_CHOICES.map(
  (choice) => choice.value,
);
const MINIMUM_LEVELS = [0, 3, 5, 6];

/**
 * An Event, as `create_event` / `update_event` accept it (#673, ruling R8):
 * title 3–120 characters, description at most 2000, a start not in the past
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
      location: z.string().transform((value) => emptyToNull(trimText(value))),
      capacity: z.string(),
      description: optionalText({ max: 2000, tooLong: 'description_too_long' }),
      minLevel: z.number(),
    })
    .superRefine((values, ctx) => {
      const issue = (path: keyof EventFormValues, message: string) =>
        ctx.addIssue({ code: 'custom', path: [path], message });
      if (!EVENT_TYPES.includes(values.type))
        issue('type', 'invalid_event_type');
      const group = options.groups.find((item) => item.id === values.groupId);
      if (!group) issue('groupId', 'event_group_required');

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
      else if (endsAt && startsAt && Date.parse(endsAt) <= Date.parse(startsAt))
        issue('endsAt', 'invalid_event_interval');

      const capacity = values.capacity.trim();
      if (capacity) {
        const count = Number(capacity);
        if (!Number.isInteger(count) || count < 1 || count > 1000)
          issue('capacity', 'invalid_event_capacity');
      }

      if (!MINIMUM_LEVELS.includes(values.minLevel))
        issue('minLevel', 'invalid_event_min_level');
      else if (group && values.minLevel < group.minLevel)
        issue('minLevel', 'event_min_level_below_group');
      else if (actorLevel < 9 && values.minLevel > actorLevel)
        issue('minLevel', 'event_min_level_above_actor');
    })
    .transform((values): EventDraft => ({
      title: values.title,
      type: values.type as EventType,
      groupId: values.groupId ?? 0,
      startsAt: bucharestWallTimeToIso(values.startsAt) ?? '',
      endsAt: values.endsAt ? bucharestWallTimeToIso(values.endsAt) : null,
      location: values.location,
      capacity: values.capacity.trim() ? Number(values.capacity) : null,
      description: values.description,
      minLevel: values.minLevel,
    }));
}

/** Where each reason an Event command (or this schema) raises is shown. */
export const fieldForReason: Readonly<Record<string, keyof EventFormValues>> = {
  invalid_event_title: 'title',
  title_too_short: 'title',
  title_too_long: 'title',
  description_too_long: 'description',
  invalid_event_type: 'type',
  event_group_required: 'groupId',
  starts_at_required: 'startsAt',
  starts_at_invalid: 'startsAt',
  starts_at_in_past: 'startsAt',
  ends_at_invalid: 'endsAt',
  invalid_event_interval: 'endsAt',
  invalid_event_capacity: 'capacity',
  invalid_event_min_level: 'minLevel',
  event_min_level_below_group: 'minLevel',
  event_min_level_above_actor: 'minLevel',
};
