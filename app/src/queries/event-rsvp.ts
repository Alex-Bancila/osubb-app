import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';

import { commandReason, reasonCopy } from '../lib/command-reasons';
import { queryErrorCode } from '../lib/query-error';
import { useAuth } from '../lib/auth';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import { readAllRows } from './read-all';
import type { EventAttendance } from './event-attendance';
import { keys } from './keys';

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

  constructor(kind: EventRsvpErrorKind, cause: unknown, message?: string) {
    super(message ?? ERROR_MESSAGES[kind]);
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

/**
 * The kind follows the code class; the words are the reason's own copy
 * (#1143), the class's only as the fallback.
 */
function classifyMutationError(error: unknown): EventRsvpMutationError {
  const code = queryErrorCode(error);
  const copy = reasonCopy(commandReason(error));

  if (code === 'PT400') {
    return new EventRsvpMutationError('invalid-status', error, copy);
  }
  if (code === 'PT404') {
    return new EventRsvpMutationError('event-unavailable', error, copy);
  }
  if (code === '42501') {
    return new EventRsvpMutationError('forbidden', error, copy);
  }
  return new EventRsvpMutationError('unknown', error, copy);
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
  /**
   * This Event's answer before the tap: `null` when there was none,
   * `undefined` when the member's answers had not been read. Only this
   * entry is put back: the map holds every card's answer, and another card
   * may be saving its own meanwhile.
   */
  answer: EventRsvpStatus | null | undefined;
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
 * The answer shows at once, everywhere it is read: the pressed button and
 * the Calendar chip's colour (the "Vin" set, #692) — both from the member's
 * answers (#1134) — and a manager's Cine participă (#934). A failed save
 * puts back what was there; either way both are read again from the server
 * once the command settles.
 */
export function eventRsvpMutationOptions(
  queryClient: QueryClient,
  memberId: string | undefined,
) {
  const mutationKey = ['event-rsvp', { memberId }] as const;
  return {
    mutationKey,
    mutationFn: setEventRsvp,
    onMutate: async ({
      eventId,
      status,
    }: SetEventRsvpInput): Promise<EventRsvpSnapshot | null> => {
      if (!memberId) return null;
      const answersKey = keys.events.answers(memberId);
      const attendanceKey = keys.events.attendance(eventId, memberId);
      // A read already in flight would land on top of the new answer.
      await Promise.all(
        [answersKey, attendanceKey].map((queryKey) =>
          queryClient.cancelQueries({ queryKey }),
        ),
      );

      const answers = queryClient.getQueryData<MyEventAnswers>(answersKey);
      const snapshot: EventRsvpSnapshot = {
        memberId,
        answer: answers && (answers.get(eventId) ?? null),
        attendance: queryClient.getQueryData<EventAttendance>(attendanceKey),
      };

      if (answers !== undefined) {
        queryClient.setQueryData<MyEventAnswers>(
          answersKey,
          new Map(answers).set(eventId, status),
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
      const { memberId: member, answer } = snapshot;
      if (answer !== undefined) {
        queryClient.setQueryData<MyEventAnswers>(
          keys.events.answers(member),
          (current) => {
            if (!current) return current;
            const next = new Map(current);
            if (answer === null) next.delete(eventId);
            else next.set(eventId, answer);
            return next;
          },
        );
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
        // The pressed button, and an Other OSUBB Event answered "Vin"
        // moving into colour (#692).
        queryClient.invalidateQueries({
          queryKey: keys.events.answers(memberId),
        }),
        // A manager answering their own Event sees Cine participă move (#934).
        queryClient.invalidateQueries({
          queryKey: keys.events.attendance(eventId, memberId),
        }),
      ]);
      // Another card's save still on its way has not reached the server, so
      // the read just made lacks its answer: it stays on screen until that
      // save settles in turn.
      const siblings = queryClient
        .getMutationCache()
        .findAll({ mutationKey, status: 'pending' })
        .map((mutation) => mutation.state.variables as SetEventRsvpInput)
        .filter((input) => input && input.eventId !== eventId);
      if (siblings.length > 0)
        queryClient.setQueryData<MyEventAnswers>(
          keys.events.answers(memberId),
          (current) => {
            if (!current) return current;
            const next = new Map(current);
            for (const input of siblings) next.set(input.eventId, input.status);
            return next;
          },
        );
    },
  } as const;
}

/** The viewer's answer on each Event they answered, by Event id. */
export type MyEventAnswers = ReadonlyMap<number, EventRsvpStatus>;

/** What a card needs of that read: the answers, or that they are not in. */
export type MyEventAnswersRead = {
  data: MyEventAnswers | undefined;
  isPending: boolean;
  isError: boolean;
  /** Reads them again: a failed read closes every card's answers. */
  refetch: () => unknown;
};

/**
 * Every answer this member gave, in one read for the whole Calendar (#1134)
 * rather than one per card: each card's pressed button, and the "Vin" set
 * that colours an Other OSUBB Event (#692). Explicitly self-filtered: a
 * manager may read other members' answers through RLS.
 */
export async function fetchMyEventAnswers(
  memberId: string,
): Promise<MyEventAnswers> {
  const rows = await readAllRows((from, to) =>
    supabase
      .from('event_attendance')
      .select('event_id, status')
      .eq('member_id', memberId)
      .order('event_id')
      .range(from, to),
  );
  const answers = new Map<number, EventRsvpStatus>();
  for (const row of rows)
    if (isEventRsvpStatus(row.status)) answers.set(row.event_id, row.status);
  return answers;
}

export function useMyEventAnswers() {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.events.answers(memberId ?? ''),
    queryFn: memberId ? () => fetchMyEventAnswers(memberId) : skipToken,
  });
}

/** The Events answered "Vin" (`going`) among `answers`. */
export function goingEventIds(
  answers: MyEventAnswers | undefined,
): ReadonlySet<number> {
  const going = new Set<number>();
  for (const [eventId, status] of answers ?? [])
    if (status === 'going') going.add(eventId);
  return going;
}

export function useSetEventRsvp() {
  const queryClient = useQueryClient();
  const memberId = useAuth().session?.user.id;
  return useMutation(eventRsvpMutationOptions(queryClient, memberId));
}
