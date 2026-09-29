import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { Capabilities } from '../lib/capabilities';
import { isoToBucharestWallTime } from '../lib/calendar-time';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import type {
  EventDraft,
  EventFormCampaign,
  EventFormOptions,
  EventFormValues,
} from '../screens/calendar/event-form-model';
import type { EventPresentation } from './events';
import { keys } from './keys';
import type { Group } from './reference';

type ManagedEvent = Pick<
  EventPresentation,
  'groupId' | 'group' | 'createdBy' | 'cancelledAt'
>;

/**
 * Whether to offer **Editează** and **Anulează evenimentul** on this card —
 * the gate `update_event` and `cancel_event` apply, in the same order
 * (ADR-0008 amended by ADR-0009):
 *
 * - a cancelled Event is terminal (`event_cancelled`), so nobody is offered it;
 * - an Organization Group Event: its creator, or BC/Moderator (level ≥ 6,
 *   `createTopLevelGroups`) — holding a Group Role, which is enough to
 *   *create* one, is not enough to edit someone else's;
 * - any other Group: BC/Moderator, or a Group Manager/Responsible of the
 *   Group or of a Group above it while it is active — exactly the Groups
 *   `buildEventFormOptions` offers for a new Event, so the two stay one rule.
 *
 * Presentation only: the command decides again inside its transaction.
 */
export function canManageEvent(
  event: ManagedEvent,
  viewer: {
    memberId: string | undefined;
    capabilities: Pick<Capabilities, 'createTopLevelGroups'>;
    options: Pick<EventFormOptions, 'groups'>;
  },
): boolean {
  if (event.cancelledAt !== null || !viewer.memberId || !event.group)
    return false;
  if (viewer.capabilities.createTopLevelGroups) return true;
  if (event.group.is_organization)
    return event.createdBy !== null && event.createdBy === viewer.memberId;
  return viewer.options.groups.some((group) => group.id === event.groupId);
}

/** The edit form, prefilled from the Event as its card shows it. */
export function eventFormValuesFor(event: EventPresentation): EventFormValues {
  return {
    title: event.title,
    type: event.type,
    groupId: event.groupId,
    startsAt: isoToBucharestWallTime(event.startsAt),
    endsAt: event.endsAt ? isoToBucharestWallTime(event.endsAt) : '',
    location: event.location ?? '',
    capacity: event.capacity === null ? '' : String(event.capacity),
    description: event.description ?? '',
    minLevel: event.minLevel,
    campaignId: event.campaignId,
    announce: false,
  };
}

/**
 * The form's choices for editing this Event: the new-Event choices, plus what
 * the Event already carries and the server keeps — its own Group (an
 * Organization Event's creator may hold no Group Role any more) and its
 * Campaign when that Campaign has since gone inactive (a Campaign attached
 * before it was deactivated is preserved, #691).
 */
export function editEventFormOptions(
  options: EventFormOptions,
  event: EventPresentation,
  groups: ReadonlyMap<number, Group> | undefined,
  allCampaigns: readonly EventFormCampaign[] = [],
): EventFormOptions {
  let formGroups = options.groups;
  const own = event.groupId === null ? undefined : groups?.get(event.groupId);
  if (own && !formGroups.some((group) => group.id === own.id))
    formGroups = [
      {
        id: own.id,
        name: own.name,
        path: own.path,
        minLevel: own.min_level,
        isOrganization: own.is_organization,
      },
      ...formGroups,
    ];

  let campaigns = options.campaigns;
  if (
    event.campaignId !== null &&
    !campaigns.some((campaign) => campaign.id === event.campaignId)
  ) {
    const kept = allCampaigns.find(
      (campaign) => campaign.id === event.campaignId,
    );
    if (kept)
      campaigns = [
        ...campaigns,
        { id: kept.id, name: kept.name, group_id: kept.group_id },
      ];
  }

  return { ...options, groups: formGroups, campaigns };
}

/**
 * The form shows minutes; a stored time may carry seconds. A time the member
 * did not touch is sent back exactly as stored, so a title edit is never read
 * as a new schedule (which would notify the Group).
 */
export function keepUntouchedTimes(
  draft: EventDraft,
  values: EventFormValues,
  initial: EventFormValues,
  event: Pick<EventPresentation, 'startsAt' | 'endsAt'>,
): EventDraft {
  return {
    ...draft,
    startsAt:
      values.startsAt === initial.startsAt ? event.startsAt : draft.startsAt,
    endsAt:
      values.endsAt === initial.endsAt && event.endsAt !== null
        ? event.endsAt
        : draft.endsAt,
  };
}

export async function updateEvent({
  eventId,
  draft,
}: {
  eventId: number;
  draft: EventDraft;
}) {
  // A full-state replace: every argument is written, so a null clears it.
  const args = {
    p_event_id: eventId,
    p_title: draft.title,
    p_type: draft.type,
    p_group_id: draft.groupId,
    p_starts_at: draft.startsAt,
    p_ends_at: draft.endsAt,
    p_location: draft.location,
    p_capacity: draft.capacity,
    p_description: draft.description,
    p_min_level: draft.minLevel,
    p_campaign_id: draft.campaignId,
  };
  // As in createEvent: PostgreSQL takes NULL for the optional values, which
  // the generated optional RPC properties do not spell.
  const { data, error } = await supabase.rpc(
    'update_event',
    args as unknown as Database['public']['Functions']['update_event']['Args'],
  );
  if (error) throw error;
  return data;
}

export async function cancelEvent({
  eventId,
  reason,
}: {
  eventId: number;
  reason: string;
}) {
  const { data, error } = await supabase.rpc('cancel_event', {
    p_event_id: eventId,
    p_reason: reason,
  });
  if (error) throw error;
  return data;
}

/**
 * Every Event read hangs under `['events']`: the Calendar's windows, the
 * `?event=` landing and Acasă's Următorul eveniment all refetch.
 */
export function useUpdateEvent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: updateEvent,
    onSuccess: () => client.invalidateQueries({ queryKey: keys.events.all }),
  });
}

export function useCancelEvent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: cancelEvent,
    onSuccess: () => client.invalidateQueries({ queryKey: keys.events.all }),
  });
}
