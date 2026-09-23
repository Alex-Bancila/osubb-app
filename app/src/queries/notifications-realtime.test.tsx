import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSupabaseMock, supabaseMock } from '../test/supabase-mock';
import { keys } from './keys';

vi.mock('../lib/supabase', async () => {
  const { supabaseClientMock } = await vi.importActual<
    typeof import('../test/supabase-mock')
  >('../test/supabase-mock');
  return { supabase: supabaseClientMock };
});

import { useNotificationRealtime } from './notifications-realtime';

const memberId = 'a1000000-0000-0000-0000-000000000604';

describe('notification Realtime signal', () => {
  beforeEach(() => resetSupabaseMock());

  it('filters one channel to the member, invalidates both queries, and closes on sign-out', async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { rerender } = renderHook(
      ({ id }: { id: string | null }) =>
        useNotificationRealtime(id ?? undefined),
      { wrapper, initialProps: { id: memberId as string | null } },
    );

    await waitFor(() => expect(supabaseMock.channel).toHaveBeenCalledOnce());
    expect(supabaseMock.channel).toHaveBeenCalledWith(
      expect.stringMatching(`^notifications:${memberId}:[0-9]+$`),
    );
    expect(supabaseMock.on).toHaveBeenCalledWith(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `member_id=eq.${memberId}`,
      },
      expect.any(Function),
    );
    expect(supabaseMock.subscribe).toHaveBeenCalledOnce();
    const statusCallback = supabaseMock.subscribe.mock.calls[0]?.[0] as (
      status: string,
    ) => void;
    act(() => statusCallback('SUBSCRIBED'));
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: keys.notifications.list(memberId),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: keys.notifications.unread(memberId),
    });
    invalidate.mockClear();
    rerender({ id: memberId });
    expect(supabaseMock.channel).toHaveBeenCalledOnce();

    const callback = supabaseMock.on.mock.calls[0]?.[2] as () => void;
    act(() => callback());
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: keys.notifications.list(memberId),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: keys.notifications.unread(memberId),
    });

    rerender({ id: null });
    expect(supabaseMock.removeChannel).toHaveBeenCalledWith(supabaseMock);
    expect(supabaseMock.channel).toHaveBeenCalledOnce();
    invalidate.mockClear();
    act(() => callback());
    expect(invalidate).not.toHaveBeenCalled();

    rerender({ id: 'a1000000-0000-0000-0000-000000000605' });
    await waitFor(() => expect(supabaseMock.channel).toHaveBeenCalledTimes(2));
    expect(supabaseMock.on).toHaveBeenLastCalledWith(
      'postgres_changes',
      expect.objectContaining({
        filter: 'member_id=eq.a1000000-0000-0000-0000-000000000605',
      }),
      expect.any(Function),
    );
  });

  it('uses a fresh topic on a remount while the old unsubscribe is pending', async () => {
    const queryClient = new QueryClient();
    const channels: Array<{
      on: ReturnType<typeof vi.fn>;
      subscribe: ReturnType<typeof vi.fn>;
    }> = [];
    supabaseMock.channel.mockImplementation(() => {
      const channel = {
        on: vi.fn(),
        subscribe: vi.fn(),
      };
      channel.on.mockReturnValue(channel);
      channel.subscribe.mockReturnValue(channel);
      channels.push(channel);
      return channel;
    });
    supabaseMock.removeChannel.mockReturnValue(new Promise(() => undefined));
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const first = renderHook(() => useNotificationRealtime(memberId), {
      wrapper,
    });
    await waitFor(() => expect(supabaseMock.channel).toHaveBeenCalledOnce());
    first.unmount();
    renderHook(() => useNotificationRealtime(memberId), { wrapper });

    await waitFor(() => expect(supabaseMock.channel).toHaveBeenCalledTimes(2));
    expect(supabaseMock.channel.mock.calls[0]?.[0]).not.toBe(
      supabaseMock.channel.mock.calls[1]?.[0],
    );
    expect(supabaseMock.removeChannel).toHaveBeenCalledWith(channels[0]);
    expect(supabaseMock.removeChannel).not.toHaveBeenCalledWith(channels[1]);
    expect(channels[1]?.subscribe).toHaveBeenCalledOnce();
  });

  it('does not subscribe if sign-out wins the dynamic import race', async () => {
    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const view = renderHook(() => useNotificationRealtime(memberId), {
      wrapper,
    });
    view.unmount();
    await import('./notifications-realtime-channel');
    expect(supabaseMock.channel).not.toHaveBeenCalled();
  });
});
