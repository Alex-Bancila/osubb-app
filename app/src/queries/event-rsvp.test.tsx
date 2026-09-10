import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  byEvent: vi.fn(),
  byMember: vi.fn(),
  maybeSingle: vi.fn(),
  rpc: vi.fn(),
}));
const auth = vi.hoisted(() => ({ useAuth: vi.fn() }));

vi.mock('../lib/supabase', () => ({
  supabase: { from: api.from, rpc: api.rpc },
}));
vi.mock('../lib/auth', () => ({ useAuth: auth.useAuth }));

import {
  EventRsvpMutationError,
  eventRsvpMutationOptions,
  eventRsvpQueryOptions,
  fetchEventRsvp,
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
    api.from.mockReturnValue({ select: api.select });
    api.select.mockReturnValue({ eq: api.byEvent });
    api.byEvent.mockReturnValue({ eq: api.byMember });
    api.byMember.mockReturnValue({ maybeSingle: api.maybeSingle });
  });

  it('filters one event response by the signed-in member id', async () => {
    api.maybeSingle.mockResolvedValue({ data: rsvpRow, error: null });

    await expect(fetchEventRsvp(42, memberId)).resolves.toEqual({
      eventId: 42,
      memberId,
      status: 'going',
      checkedIn: false,
    });

    expect(api.from).toHaveBeenCalledWith('event_attendance');
    expect(api.select).toHaveBeenCalledWith(
      'event_id, member_id, status, checked_in',
    );
    expect(api.byEvent).toHaveBeenCalledWith('event_id', 42);
    expect(api.byMember).toHaveBeenCalledWith('member_id', memberId);
    expect(api.maybeSingle).toHaveBeenCalledOnce();
  });

  it('returns null when the member has not answered', async () => {
    api.maybeSingle.mockResolvedValue({ data: null, error: null });

    await expect(fetchEventRsvp(42, memberId)).resolves.toBeNull();
  });

  it('surfaces read failures to React Query', async () => {
    const error = { code: '42501', message: 'permission denied' };
    api.maybeSingle.mockResolvedValue({ data: null, error });

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
    api.maybeSingle.mockResolvedValue({ data: rsvpRow, error: null });
    auth.useAuth.mockReturnValue({ session: { user: { id: memberId } } });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => useEventRsvp(42), {
      wrapper: wrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.memberId).toBe(memberId);
    expect(api.byMember).toHaveBeenCalledWith('member_id', memberId);
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
    expect(api.from).not.toHaveBeenCalled();
  });
});

describe('RSVP mutation', () => {
  it('sends only event id and status to the self-owned RPC', async () => {
    api.rpc.mockResolvedValue({ data: rsvpRow, error: null });

    await expect(
      setEventRsvp({ eventId: 42, status: 'going' }),
    ).resolves.toEqual({
      eventId: 42,
      memberId,
      status: 'going',
      checkedIn: false,
    });

    expect(api.rpc).toHaveBeenCalledWith('set_event_rsvp', {
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
      api.rpc.mockResolvedValue({ data: null, error: backendError });

      const failure = await setEventRsvp({
        eventId: 42,
        status: 'declined',
      }).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(EventRsvpMutationError);
      expect(failure).toMatchObject({ kind, message });
      expect(failure).not.toHaveProperty('message', 'internal detail');
    },
  );

  it('invalidates only the returned member and event after success', async () => {
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

    expect(invalidate).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['events', 'rsvp', { eventId: 42, memberId }],
    });
  });

  it('wires the RPC and invalidation through the mutation hook', async () => {
    api.rpc.mockResolvedValue({ data: rsvpRow, error: null });
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

    expect(api.rpc).toHaveBeenCalledWith('set_event_rsvp', {
      p_event_id: 42,
      p_status: 'going',
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['events', 'rsvp', { eventId: 42, memberId }],
    });
  });
});
