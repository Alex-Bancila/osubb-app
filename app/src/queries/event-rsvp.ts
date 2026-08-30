import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';

import { useAuth } from '../lib/auth';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

const RSVP_FIELDS = 'event_id, member_id, status, checked_in';

type EventAttendanceRow =
  Database['public']['Tables']['event_attendance']['Row'];
type EventRsvpRow = Pick<
  EventAttendanceRow,
  'event_id' | 'member_id' | 'status' | 'checked_in'
>;

export type EventRsvpStatus = 'going' | 'declined';

export type EventRsvp = {
  eventId: number;
  memberId: string;
  status: EventRsvpStatus;
  checkedIn: boolean;
};

export type SetEventRsvpInput = {
  eventId: number;
  status: EventRsvpStatus;
};

export type EventRsvpErrorKind =
  'invalid-status' | 'event-unavailable' | 'forbidden' | 'unknown';

const ERROR_MESSAGES: Record<EventRsvpErrorKind, string> = {
  'invalid-status': 'Răspunsul ales nu este valid.',
  'event-unavailable': 'Evenimentul nu mai este disponibil pentru răspuns.',
  forbidden: 'Nu mai ai permisiunea să răspunzi la acest eveniment.',
  unknown: 'Nu am putut salva răspunsul. Încearcă din nou.',
};

/** A UI-safe failure: raw PostgREST details stay available only as `cause`. */
export class EventRsvpMutationError extends Error {
  readonly kind: EventRsvpErrorKind;
  override readonly cause: unknown;

  constructor(kind: EventRsvpErrorKind, cause: unknown) {
    super(ERROR_MESSAGES[kind]);
    this.name = 'EventRsvpMutationError';
    this.kind = kind;
    this.cause = cause;
  }
}

function isEventRsvpStatus(value: string): value is EventRsvpStatus {
  return value === 'going' || value === 'declined';
}

function toEventRsvp(row: EventRsvpRow): EventRsvp {
  if (!isEventRsvpStatus(row.status)) {
    throw new EventRsvpMutationError('unknown', row);
  }

  return {
    eventId: row.event_id,
    memberId: row.member_id,
    status: row.status,
    checkedIn: row.checked_in === true,
  };
}

function classifyMutationError(error: unknown): EventRsvpMutationError {
  const code = (error as { code?: unknown } | null)?.code;

  if (code === 'PT400') {
    return new EventRsvpMutationError('invalid-status', error);
  }
  if (code === 'PT404') {
    return new EventRsvpMutationError('event-unavailable', error);
  }
  if (code === '42501') {
    return new EventRsvpMutationError('forbidden', error);
  }
  return new EventRsvpMutationError('unknown', error);
}

/**
 * Read at most one answer for this exact member and event.
 *
 * Managers may read other attendance rows through RLS, so the explicit member
 * filter is essential: this hook models the caller's answer, not every answer
 * they happen to be authorised to inspect.
 */
export async function fetchEventRsvp(
  eventId: number,
  memberId: string,
): Promise<EventRsvp | null> {
  const { data, error } = await supabase
    .from('event_attendance')
    .select(RSVP_FIELDS)
    .eq('event_id', eventId)
    .eq('member_id', memberId)
    .maybeSingle();
  if (error) throw error;

  return data ? toEventRsvp(data) : null;
}

export function eventRsvpQueryOptions(eventId: number, memberId: string) {
  return {
    queryKey: keys.events.rsvp(eventId, memberId),
    queryFn: () => fetchEventRsvp(eventId, memberId),
  } as const;
}

export function useEventRsvp(eventId: number) {
  const { session } = useAuth();
  const memberId = session?.user.id;

  return useQuery({
    ...eventRsvpQueryOptions(eventId, memberId ?? ''),
    enabled: Boolean(memberId),
  });
}

/** Call the self-owned command; a member id is deliberately not an argument. */
export async function setEventRsvp(
  input: SetEventRsvpInput,
): Promise<EventRsvp> {
  const { data, error } = await supabase.rpc('set_event_rsvp', {
    p_event_id: input.eventId,
    p_status: input.status,
  });

  if (error) throw classifyMutationError(error);
  if (!data) throw new EventRsvpMutationError('unknown', data);

  return toEventRsvp(data);
}

export function eventRsvpMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: setEventRsvp,
    onSuccess: async (rsvp: EventRsvp) => {
      await queryClient.invalidateQueries({
        queryKey: keys.events.rsvp(rsvp.eventId, rsvp.memberId),
      });
    },
  } as const;
}

export function useSetEventRsvp() {
  const queryClient = useQueryClient();
  return useMutation(eventRsvpMutationOptions(queryClient));
}
