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
};

/** The Event dialog: a full screen on a phone, a wide dialog above it. */
export const eventDialogContentClass =
  'max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-none max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none';

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
  campaignId: number | null;
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

/**
 * "Cine îl vede": the ladder rungs `events_min_level_ck` accepts, by Role name
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
