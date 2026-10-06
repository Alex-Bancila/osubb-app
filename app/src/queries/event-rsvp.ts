import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';

import { queryErrorCode } from '../lib/query-error';
import { useAuth } from '../lib/auth';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import type { EventAttendance } from './event-attendance';
import { keys } from './keys';

export const RSVP_FIELDS = 'event_id, member_id, status, checked_in';

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
  const code = queryErrorCode(error);

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

/** What an answer replaced in the cache, to put back if the save fails. */
export type EventRsvpSnapshot = {
  memberId: string;
  rsvp: EventRsvp | null | undefined;
  going: number[] | undefined;
  attendance: EventAttendance | undefined;
};

/** Move one member's answer between the two lists of **Cine participă**. */
function withAnswer(
  attendance: EventAttendance,
  memberId: string,
  status: EventRsvpStatus,
): EventAttendance {
  const others = (ids: string[]) => ids.filter((id) => id !== memberId);
  return {
    going:
      status === 'going'
        ? [...others(attendance.going), memberId]
        : others(attendance.going),
    declined:
      status === 'declined'
        ? [...others(attendance.declined), memberId]
        : others(attendance.declined),
  };
}

/**
 * The answer shows at once, everywhere it is read: the pressed button, the
 * Calendar chip's colour (the "Vin" set, #692) and a manager's Cine participă
 * (#934). A failed save puts back what was there; either way the three are
 * read again from the server once the command settles.
 */
export function eventRsvpMutationOptions(
  queryClient: QueryClient,
  memberId: string | undefined,
) {
  return {
    mutationFn: setEventRsvp,
    onMutate: async ({
      eventId,
      status,
    }: SetEventRsvpInput): Promise<EventRsvpSnapshot | null> => {
      if (!memberId) return null;
      const rsvpKey = keys.events.rsvp(eventId, memberId);
      const goingKey = keys.events.going(memberId);
      const attendanceKey = keys.events.attendance(eventId, memberId);
      // A read already in flight would land on top of the new answer.
      await Promise.all(
        [rsvpKey, goingKey, attendanceKey].map((queryKey) =>
          queryClient.cancelQueries({ queryKey }),
        ),
      );

      const snapshot: EventRsvpSnapshot = {
        memberId,
        rsvp: queryClient.getQueryData<EventRsvp | null>(rsvpKey),
        going: queryClient.getQueryData<number[]>(goingKey),
        attendance: queryClient.getQueryData<EventAttendance>(attendanceKey),
      };

      queryClient.setQueryData<EventRsvp | null>(rsvpKey, (previous) =>
        previous
          ? { ...previous, status }
          : { eventId, memberId, status, checkedIn: false },
      );
      if (snapshot.going !== undefined) {
        const others = snapshot.going.filter((id) => id !== eventId);
        queryClient.setQueryData<number[]>(
          goingKey,
          status === 'going' ? [...others, eventId] : others,
        );
      }
      if (snapshot.attendance !== undefined) {
        queryClient.setQueryData<EventAttendance>(
          attendanceKey,
          withAnswer(snapshot.attendance, memberId, status),
        );
      }
      return snapshot;
    },
    onError: (
      _error: unknown,
      { eventId }: SetEventRsvpInput,
      snapshot: EventRsvpSnapshot | null | undefined,
    ) => {
      if (!snapshot) return;
      const { memberId: member } = snapshot;
      if (snapshot.rsvp !== undefined) {
        queryClient.setQueryData(
          keys.events.rsvp(eventId, member),
          snapshot.rsvp,
        );
      }
      if (snapshot.going !== undefined) {
        queryClient.setQueryData(keys.events.going(member), snapshot.going);
      }
      if (snapshot.attendance !== undefined) {
        queryClient.setQueryData(
          keys.events.attendance(eventId, member),
          snapshot.attendance,
        );
      }
    },
    onSettled: async (
      _data: EventRsvp | undefined,
      _error: unknown,
      { eventId }: SetEventRsvpInput,
    ) => {
      if (!memberId) return;
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: keys.events.rsvp(eventId, memberId),
        }),
        // An Other OSUBB Event answered "Vin" moves into colour (#692).
        queryClient.invalidateQueries({
          queryKey: keys.events.going(memberId),
        }),
        // A manager answering their own Event sees Cine participă move (#934).
        queryClient.invalidateQueries({
          queryKey: keys.events.attendance(eventId, memberId),
        }),
      ]);
    },
  } as const;
}

/**
 * The ids of the Events this member answered "Vin" (`going`) to, in one read
 * for the whole Calendar rather than one per chip. Explicitly self-filtered:
 * a manager may read other members' answers through RLS.
 */
export async function fetchGoingEventIds(memberId: string): Promise<number[]> {
  const { data, error } = await supabase
    .from('event_attendance')
    .select('event_id')
    .eq('member_id', memberId)
    .eq('status', 'going');
  if (error) throw error;
  return (data ?? []).map((row) => row.event_id);
}

export function useGoingEventIds() {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.events.going(memberId ?? ''),
    queryFn: memberId ? () => fetchGoingEventIds(memberId) : skipToken,
  });
}

export function useSetEventRsvp() {
  const queryClient = useQueryClient();
  const memberId = useAuth().session?.user.id;
  return useMutation(eventRsvpMutationOptions(queryClient, memberId));
}
