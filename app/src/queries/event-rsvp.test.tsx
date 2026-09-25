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
  eventRsvpQueryOptions,
  fetchEventRsvp,
  fetchGoingEventIds,
  setEventRsvp,
  useEventRsvp,
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

describe('current-member RSVP query', () => {
  beforeEach(() => {
    resetSupabaseMock();
  });

  it('filters one event response by the signed-in member id', async () => {
    supabaseMock.maybeSingle.mockResolvedValue({ data: rsvpRow, error: null });

    await expect(fetchEventRsvp(42, memberId)).resolves.toEqual({
      eventId: 42,
      memberId,
      status: 'going',
      checkedIn: false,
    });

    expect(supabaseMock.from).toHaveBeenCalledWith('event_attendance');
    expect(supabaseMock.select).toHaveBeenCalledWith(
      'event_id, member_id, status, checked_in',
    );
    expect(supabaseMock.eq).toHaveBeenNthCalledWith(1, 'event_id', 42);
    expect(supabaseMock.eq).toHaveBeenNthCalledWith(2, 'member_id', memberId);
    expect(supabaseMock.maybeSingle).toHaveBeenCalledOnce();
  });

  it('returns null when the member has not answered', async () => {
    supabaseMock.maybeSingle.mockResolvedValue({ data: null, error: null });

    await expect(fetchEventRsvp(42, memberId)).resolves.toBeNull();
  });

  it('surfaces read failures to React Query', async () => {
    const error = { code: '42501', message: 'permission denied' };
    supabaseMock.maybeSingle.mockResolvedValue({ data: null, error });

    await expect(fetchEventRsvp(42, memberId)).rejects.toBe(error);
  });

  it('isolates cached answers by event and member', () => {
    const ioana = eventRsvpQueryOptions(42, memberId);
    const vlad = eventRsvpQueryOptions(
      42,
      'b2000000-0000-0000-0000-000000000238',
    );
    const anotherEvent = eventRsvpQueryOptions(43, memberId);

    expect(ioana.queryKey).toEqual([
      'events',
      'rsvp',
      { eventId: 42, memberId },
    ]);
    expect(ioana.queryKey).not.toEqual(vlad.queryKey);
    expect(ioana.queryKey).not.toEqual(anotherEvent.queryKey);
  });

  it('derives the member filter from the active session', async () => {
    supabaseMock.maybeSingle.mockResolvedValue({ data: rsvpRow, error: null });
    auth.useAuth.mockReturnValue({ session: { user: { id: memberId } } });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => useEventRsvp(42), {
      wrapper: wrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.memberId).toBe(memberId);
    expect(supabaseMock.eq).toHaveBeenCalledWith('member_id', memberId);
  });

  it('does not issue a member query without a session', () => {
    auth.useAuth.mockReturnValue({ session: null });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => useEventRsvp(42), {
      wrapper: wrapper(queryClient),
    });

    expect(result.current.fetchStatus).toBe('idle');
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

  it('invalidates the returned member and event, and their Vin set, after success', async () => {
    const queryClient = new QueryClient();
    const invalidate = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue(undefined);
    const options = eventRsvpMutationOptions(queryClient);

    await options.onSuccess({
      eventId: 42,
      memberId,
      status: 'declined',
      checkedIn: false,
    });

    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['events', 'rsvp', { eventId: 42, memberId }],
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['events', 'going', { memberId }],
    });
  });

  it('wires the RPC and invalidation through the mutation hook', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: rsvpRow, error: null });
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
      queryKey: ['events', 'rsvp', { eventId: 42, memberId }],
    });
  });
});

describe('the Events I said Vin to', () => {
  beforeEach(() => {
    resetSupabaseMock();
  });

  // One read colours every Other OSUBB Event answered "Vin" (#692). Mutation
  // this catches: dropping the self-filter, which would colour the Events
  // other members answered for a manager who may read their rows.
  it('reads only my going answers', async () => {
    supabaseMock.eq.mockReturnValueOnce(supabaseMock).mockResolvedValueOnce({
      data: [{ event_id: 4 }, { event_id: 9 }],
      error: null,
    });

    await expect(fetchGoingEventIds(memberId)).resolves.toEqual([4, 9]);
    expect(supabaseMock.from).toHaveBeenCalledWith('event_attendance');
    expect(supabaseMock.eq).toHaveBeenNthCalledWith(1, 'member_id', memberId);
    expect(supabaseMock.eq).toHaveBeenNthCalledWith(2, 'status', 'going');
  });
});
