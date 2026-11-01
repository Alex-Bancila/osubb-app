import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSupabaseMock, supabaseMock } from '../test/supabase-mock';

const auth = vi.hoisted(() => ({ useAuth: vi.fn() }));

vi.mock('../lib/supabase', async () => {
  const { supabaseClientMock } = await vi.importActual<
    typeof import('../test/supabase-mock')
  >('../test/supabase-mock');
  return { supabase: supabaseClientMock };
});
vi.mock('../lib/auth', () => ({ useAuth: auth.useAuth }));

import {
  EventRsvpMutationError,
  eventRsvpMutationOptions,
  fetchMyEventAnswers,
  goingEventIds,
  setEventRsvp,
  useMyEventAnswers,
  useSetEventRsvp,
} from './event-rsvp';

const memberId = 'a1000000-0000-0000-0000-000000000238';
const rsvpRow = {
  event_id: 42,
  member_id: memberId,
  status: 'going',
  checked_in: false,
};

function wrapper(queryClient: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe('the member’s answers, one read for the Calendar (#1134)', () => {
  beforeEach(() => {
    resetSupabaseMock();
  });

  // Mutation this catches: dropping the self-filter, which would show a
  // manager the answers of every member they may read as their own.
  it('reads only my answers, by the page, as a map from Event to answer', async () => {
    supabaseMock.range.mockResolvedValue({
      data: [
        { event_id: 4, status: 'going' },
        { event_id: 9, status: 'declined' },
      ],
      error: null,
    });

    const answers = await fetchMyEventAnswers(memberId);

    expect([...answers]).toEqual([
      [4, 'going'],
      [9, 'declined'],
    ]);
    expect(supabaseMock.from).toHaveBeenCalledWith('event_attendance');
    expect(supabaseMock.select).toHaveBeenCalledWith('event_id, status');
    expect(supabaseMock.eq).toHaveBeenCalledOnce();
    expect(supabaseMock.eq).toHaveBeenCalledWith('member_id', memberId);
    expect(supabaseMock.order).toHaveBeenCalledWith('event_id');
    expect(supabaseMock.range).toHaveBeenCalledWith(0, 499);
  });

  it('surfaces a failed read to React Query', async () => {
    const error = { code: '42501', message: 'permission denied' };
    supabaseMock.range.mockResolvedValue({ data: null, error });

    await expect(fetchMyEventAnswers(memberId)).rejects.toBe(error);
  });

  it('tells the Vin set apart from the rest', () => {
    expect([
      ...goingEventIds(
        new Map([
          [4, 'going'],
          [9, 'declined'],
          [12, 'going'],
        ] as const),
      ),
    ]).toEqual([4, 12]);
    expect(goingEventIds(undefined).size).toBe(0);
  });

  it('reads under the signed-in member and asks nothing without a session', async () => {
    supabaseMock.range.mockResolvedValue({ data: [], error: null });
    auth.useAuth.mockReturnValue({ session: { user: { id: memberId } } });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useMyEventAnswers(), {
      wrapper: wrapper(queryClient),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(
      queryClient.getQueryData(['events', 'answers', { memberId }]),
    ).toBeInstanceOf(Map);

    resetSupabaseMock();
    auth.useAuth.mockReturnValue({ session: null });
    const signedOut = renderHook(() => useMyEventAnswers(), {
      wrapper: wrapper(new QueryClient()),
    });
    expect(signedOut.result.current.fetchStatus).toBe('idle');
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });
});

describe('RSVP mutation', () => {
  it('sends only event id and status to the self-owned RPC', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: rsvpRow, error: null });

    await expect(
      setEventRsvp({ eventId: 42, status: 'going' }),
    ).resolves.toEqual({
      eventId: 42,
      memberId,
      status: 'going',
      checkedIn: false,
    });

    expect(supabaseMock.rpc).toHaveBeenCalledWith('set_event_rsvp', {
      p_event_id: 42,
      p_status: 'going',
    });
  });

  it.each([
    ['PT400', 'invalid-status', 'Răspunsul ales nu este valid.'],
    [
      'PT404',
      'event-unavailable',
      'Evenimentul nu mai este disponibil pentru răspuns.',
    ],
    [
      '42501',
      'forbidden',
      'Nu mai ai permisiunea să răspunzi la acest eveniment.',
    ],
    ['PGRST301', 'unknown', 'Nu am putut salva răspunsul. Încearcă din nou.'],
  ] as const)(
    'maps backend error %s to a safe %s failure',
    async (code, kind, message) => {
      const backendError = { code, message: 'internal detail' };
      supabaseMock.rpc.mockResolvedValue({ data: null, error: backendError });

      const failure = await setEventRsvp({
        eventId: 42,
        status: 'declined',
      }).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(EventRsvpMutationError);
      expect(failure).toMatchObject({ kind, message });
      expect(failure).not.toHaveProperty('message', 'internal detail');
    },
  );

  // #1143 (audit M27): the reason the command refused with reads its own
  // copy; the class's words above are only the fallback.
  it.each([
    [
      'PT404',
      'event_not_found',
      'event-unavailable',
      'Evenimentul nu mai este disponibil. Reîncarcă pagina.',
    ],
    [
      'PT400',
      'invalid_rsvp_status',
      'invalid-status',
      'Alege dacă participi sau nu.',
    ],
    ['42501', 'not_active_member', 'forbidden', 'Contul tău nu este activ.'],
  ] as const)(
    'reads %s %s in its own copy',
    async (code, reason, kind, copy) => {
      supabaseMock.rpc.mockResolvedValue({
        data: null,
        error: { code, message: reason },
      });

      const failure = await setEventRsvp({
        eventId: 42,
        status: 'going',
      }).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(EventRsvpMutationError);
      expect(failure).toMatchObject({ kind, message: copy });
    },
  );

  it('reads the member’s answers and the Event’s Cine participă again once settled', async () => {
    const queryClient = new QueryClient();
    const invalidate = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue(undefined);
    const options = eventRsvpMutationOptions(queryClient, memberId);

    await options.onSettled(undefined, new Error('x'), {
      eventId: 42,
      status: 'declined',
    });

    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['events', 'answers', { memberId }],
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['events', 'attendance', { eventId: 42, memberId }],
    });
  });

  // Everything that reads the answer moves at once (Alex, 2026-10-06: "show
  // through ui that their action happened"), and goes back if the save fails.
  it('shows the new answer everywhere before the server replies, and puts the old one back on failure', async () => {
    const queryClient = new QueryClient();
    const answersKey = ['events', 'answers', { memberId }];
    const attendanceKey = ['events', 'attendance', { eventId: 42, memberId }];
    const before = {
      answers: new Map([
        [4, 'going'],
        [42, 'going'],
      ]),
      attendance: { going: ['other', memberId], declined: ['third'] },
    };
    queryClient.setQueryData(answersKey, before.answers);
    queryClient.setQueryData(attendanceKey, before.attendance);
    const options = eventRsvpMutationOptions(queryClient, memberId);
    const input = { eventId: 42, status: 'declined' } as const;

    const snapshot = await options.onMutate(input);

    expect([
      ...(queryClient.getQueryData<Map<number, string>>(answersKey) ?? []),
    ]).toEqual([
      [4, 'going'],
      [42, 'declined'],
    ]);
    // The cached map is replaced, never changed in place.
    expect(before.answers.get(42)).toBe('going');
    expect(queryClient.getQueryData(attendanceKey)).toEqual({
      going: ['other'],
      declined: ['third', memberId],
    });

    options.onError(new Error('x'), input, snapshot);

    expect(queryClient.getQueryData(answersKey)).toBe(before.answers);
    expect(queryClient.getQueryData(attendanceKey)).toEqual(before.attendance);
  });

  it('writes a first answer into the member’s answers, which joins the Vin set', async () => {
    const queryClient = new QueryClient();
    const answersKey = ['events', 'answers', { memberId }];
    queryClient.setQueryData(answersKey, new Map([[4, 'going']]));
    const options = eventRsvpMutationOptions(queryClient, memberId);

    const snapshot = await options.onMutate({ eventId: 42, status: 'going' });

    const answers =
      queryClient.getQueryData<Map<number, 'going' | 'declined'>>(answersKey);
    expect(answers?.get(42)).toBe('going');
    expect([...goingEventIds(answers)]).toEqual([4, 42]);

    options.onError(new Error('x'), { eventId: 42, status: 'going' }, snapshot);
    expect([
      ...(queryClient.getQueryData<Map<number, string>>(answersKey) ?? []),
    ]).toEqual([[4, 'going']]);
  });

  it('wires the RPC and invalidation through the mutation hook', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: rsvpRow, error: null });
    auth.useAuth.mockReturnValue({ session: { user: { id: memberId } } });
    const queryClient = new QueryClient();
    const invalidate = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue(undefined);
    const { result } = renderHook(() => useSetEventRsvp(), {
      wrapper: wrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ eventId: 42, status: 'going' });
    });

    expect(supabaseMock.rpc).toHaveBeenCalledWith('set_event_rsvp', {
      p_event_id: 42,
      p_status: 'going',
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['events', 'answers', { memberId }],
    });
  });
});
