import type { Database } from '../../lib/database.types';
import { bucharestWallTimeToIso } from '../../lib/calendar-time';

export type EventType = Database['public']['Enums']['event_type'];

export type EventFormGroup = {
  id: number;
  name: string;
  path: number[];
  minLevel: number;
  isOrganization: boolean;
};

export type EventFormOptions = {
  groups: EventFormGroup[];
  groupNames: Array<{ id: number; name: string }>;
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
};

export type EventDraft = {
  title: string;
  type: EventType;
  groupId: number;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  capacity: number | null;
  description: string | null;
  minLevel: number;
};

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

const MINIMUM_LEVELS = [
  { value: 0, label: 'Toți membrii' },
  { value: 3, label: 'Membru cu Drept de Vot+' },
  { value: 5, label: 'BCE+' },
  { value: 6, label: 'BC+' },
] as const;

const eventTypes = new Set<EventType>(
  EVENT_TYPE_CHOICES.map((choice) => choice.value),
);

export function minimumLevelChoices(groupFloor: number, actorLevel: number) {
  return MINIMUM_LEVELS.filter(
    (choice) =>
      choice.value >= groupFloor &&
      (actorLevel >= 9 || choice.value <= actorLevel),
  );
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

function optionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

/** Validate and normalize the browser draft before it reaches create_event. */
export function eventDraft(
  values: EventFormValues,
  options: EventFormOptions,
  actorLevel: number,
): EventDraft | string {
  const title = values.title.trim();
  if (!title) return 'Scrie titlul evenimentului.';
  if (!eventTypes.has(values.type)) return 'Alege un tip de eveniment valid.';

  const group = options.groups.find((item) => item.id === values.groupId);
  if (!group) return 'Alege grupul evenimentului.';

  const startsAt = bucharestWallTimeToIso(values.startsAt);
  if (!startsAt) return 'Ora de început nu există în fusul orar al României.';

  const endsAt = values.endsAt ? bucharestWallTimeToIso(values.endsAt) : null;
  if (values.endsAt && !endsAt)
    return 'Ora de încheiere nu există în fusul orar al României.';
  if (endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime())
    return 'Ora de încheiere trebuie să fie după ora de început.';

  let capacity: number | null = null;
  if (values.capacity.trim()) {
    capacity = Number(values.capacity);
    if (!Number.isInteger(capacity) || capacity <= 0)
      return 'Capacitatea trebuie să fie un număr întreg pozitiv.';
  }

  if (![0, 3, 5, 6].includes(values.minLevel))
    return 'Alege un nivel minim valid.';
  if (values.minLevel < group.minLevel)
    return 'Nivelul minim nu poate fi sub nivelul grupului.';
  if (actorLevel < 9 && values.minLevel > actorLevel)
    return 'Nu poți alege un nivel minim peste nivelul tău.';

  return {
    title,
    type: values.type,
    groupId: group.id,
    startsAt,
    endsAt,
    location: optionalText(values.location),
    capacity,
    description: optionalText(values.description),
    minLevel: values.minLevel,
  };
}
