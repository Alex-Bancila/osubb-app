import type { Database } from '../../lib/database.types';

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
