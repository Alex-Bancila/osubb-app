import {
  QueryClient,
  QueryClientProvider,
  useInfiniteQuery,
} from '@tanstack/react-query';
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

import {
  ANNOUNCEMENT_PAGE,
  announcementFeedQueryOptions,
} from './announcements';
import { useLiveChanges } from './live-changes';
import { FINISHED_PAGE, finishedTasksQueryOptions } from './task-lists';

const memberId = 'a1000000-0000-0000-0000-000000000604';

function setup() {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const view = renderHook(
    ({ id }: { id: string | undefined }) => useLiveChanges(id),
    { wrapper, initialProps: { id: memberId as string | undefined } },
  );
  return { queryClient, invalidate, ...view };
}

// The broadcast callback and the status callback the hook registered.
async function joined() {
  await waitFor(() => expect(supabaseMock.subscribe).toHaveBeenCalledOnce());
  return {
    onChange: supabaseMock.on.mock.calls[0]?.[2] as (message: unknown) => void,
    onStatus: supabaseMock.subscribe.mock.calls[0]?.[0] as (
      status: string,
    ) => void,
  };
}

describe('live change signals (#961)', () => {
  beforeEach(() => resetSupabaseMock());

  it('joins the private org:changes broadcast topic when the member shell mounts', async () => {
    setup();
    await joined();

    expect(supabaseMock.channel).toHaveBeenCalledWith('org:changes', {
      config: { private: true },
    });
    expect(supabaseMock.on).toHaveBeenCalledWith(
      'broadcast',
      { event: 'change' },
      expect.any(Function),
    );
  });

  it('invalidates the families a table feeds, once per burst, and nothing else', async () => {
    const { invalidate } = setup();
    const { onChange } = await joined();

    // One evaluate_task writes tasks, task_activity, task_evaluations… in
    // one transaction: the signals land together and cost one refetch.
    act(() => {
      onChange({ payload: { table: 'tasks', op: 'UPDATE' } });
      onChange({ payload: { table: 'task_activity', op: 'INSERT' } });
    });

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.tasks.all }),
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: keys.leadership.all,
    });
    expect(
      invalidate.mock.calls.filter(
        ([options]) => options?.queryKey === keys.tasks.all,
      ),
    ).toHaveLength(1);
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: keys.events.all,
    });
  });

  it('ignores a table it does not know and a message without one', async () => {
    const { invalidate } = setup();
    const { onChange } = await joined();

    act(() => {
      onChange({ payload: { table: 'something_new', op: 'INSERT' } });
      onChange({ payload: {} });
      onChange(undefined);
    });
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(invalidate).not.toHaveBeenCalled();
  });

  it('refetches everything after a reconnect, never on the first join', async () => {
    const { invalidate } = setup();
    const { onStatus } = await joined();

    act(() => onStatus('SUBSCRIBED'));
    expect(invalidate).not.toHaveBeenCalled();

    // The socket dropped and came back: signals may have been missed.
    act(() => onStatus('CHANNEL_ERROR'));
    act(() => onStatus('SUBSCRIBED'));
    expect(invalidate).toHaveBeenCalledWith();
  });

  describe('the finished part of a Task list, read by the page (#1053)', () => {
    /** The `p_offset` of every `task_list` request, in order. */
    const taskListOffsets = () =>
      supabaseMock.rpc.mock.calls
        .filter(([name]) => name === 'task_list')
        .map(([, args]) => (args as { p_offset: number }).p_offset);

    /** De gestionat's finished part with three of its four pages loaded. */
    async function threePagesLoaded() {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      );
      // 200 finished Tasks, 50 a page.
      supabaseMock.rpc.mockImplementation(
        (_name: string, args: { p_offset: number }) =>
          Promise.resolve({
            data: Array.from({ length: FINISHED_PAGE }, (_, index) => ({
              id: args.p_offset + index + 1,
              executor: null,
              total: 200,
            })),
            error: null,
          }),
      );
      const { result } = renderHook(
        () => {
          useLiveChanges(memberId);
          return useInfiniteQuery(
            finishedTasksQueryOptions('managed', {}, memberId),
          );
        },
        { wrapper },
      );
      await waitFor(() => expect(result.current.data?.pages).toHaveLength(1));
      await act(() => result.current.fetchNextPage());
      await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
      await act(() => result.current.fetchNextPage());
      await waitFor(() => expect(result.current.data?.pages).toHaveLength(3));
      expect(taskListOffsets()).toEqual([0, 50, 100]);
      return result;
    }

    // Fails if a change only invalidates `['tasks']`: the infinite query
    // then refetches every page it has loaded, one after another.
    it('re-reads only the first page after a change and drops the others', async () => {
      const result = await threePagesLoaded();
      const { onChange } = await joined();

      act(() => onChange({ payload: { table: 'tasks', op: 'UPDATE' } }));

      await waitFor(() => expect(taskListOffsets()).toHaveLength(4));
      await waitFor(() => expect(result.current.isFetching).toBe(false));
      // One request, for the first page; the pages after it are dropped.
      expect(taskListOffsets()).toEqual([0, 50, 100, 0]);
      expect(result.current.data?.pages).toHaveLength(1);
      expect(result.current.hasNextPage).toBe(true);
    });

    // Fails if a reconnect invalidates everything without trimming first.
    it('re-reads only the first page after a reconnect too', async () => {
      const result = await threePagesLoaded();
      const { onStatus } = await joined();

      act(() => onStatus('SUBSCRIBED'));
      act(() => onStatus('CHANNEL_ERROR'));
      act(() => onStatus('SUBSCRIBED'));

      await waitFor(() => expect(taskListOffsets()).toHaveLength(4));
      await waitFor(() => expect(result.current.isFetching).toBe(false));
      expect(taskListOffsets()).toEqual([0, 50, 100, 0]);
      expect(result.current.data?.pages).toHaveLength(1);
    });
  });

  describe('the Anunțuri feed, read by the page (R56)', () => {
    /** The `p_offset` of every `announcement_feed` request, in order. */
    const feedOffsets = () =>
      supabaseMock.rpc.mock.calls
        .filter(([name]) => name === 'announcement_feed')
        .map(([, args]) => (args as { p_offset: number }).p_offset);

    /** The feed with three of its four pages loaded. */
    async function threePagesLoaded() {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      );
      // 80 Announcements, 20 a page.
      supabaseMock.rpc.mockImplementation(
        (_name: string, args: { p_offset: number }) =>
          Promise.resolve({
            data: Array.from({ length: ANNOUNCEMENT_PAGE }, (_, index) => ({
              id: args.p_offset + index + 1,
              read_at: null,
              total: 80,
            })),
            error: null,
          }),
      );
      const { result } = renderHook(
        () => {
          useLiveChanges(memberId);
          return useInfiniteQuery(announcementFeedQueryOptions({}, memberId));
        },
        { wrapper },
      );
      await waitFor(() => expect(result.current.data?.pages).toHaveLength(1));
      await act(() => result.current.fetchNextPage());
      await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
      await act(() => result.current.fetchNextPage());
      await waitFor(() => expect(result.current.data?.pages).toHaveLength(3));
      expect(feedOffsets()).toEqual([0, 20, 40]);
      return result;
    }

    // Fails if a change cuts the feed to its first page: a Member reading
    // card 55 would lose their place over any Announcement, Group or roster
    // changed anywhere.
    it('keeps every loaded page after a change and reads each again', async () => {
      const result = await threePagesLoaded();
      const { onChange } = await joined();

      act(() =>
        onChange({ payload: { table: 'announcements', op: 'INSERT' } }),
      );

      await waitFor(() => expect(feedOffsets()).toHaveLength(6));
      await waitFor(() => expect(result.current.isFetching).toBe(false));
      expect(feedOffsets()).toEqual([0, 20, 40, 0, 20, 40]);
      expect(result.current.data?.pages).toHaveLength(3);
    });

    // Fails if a reconnect cuts the feed too.
    it('keeps every loaded page after a reconnect too', async () => {
      const result = await threePagesLoaded();
      const { onStatus } = await joined();

      act(() => onStatus('SUBSCRIBED'));
      act(() => onStatus('CHANNEL_ERROR'));
      act(() => onStatus('SUBSCRIBED'));

      await waitFor(() => expect(feedOffsets()).toHaveLength(6));
      await waitFor(() => expect(result.current.isFetching).toBe(false));
      expect(feedOffsets()).toEqual([0, 20, 40, 0, 20, 40]);
      expect(result.current.data?.pages).toHaveLength(3);
    });
  });

  it('leaves the topic on sign-out and never joins without a member', async () => {
    const view = setup();
    await joined();

    view.rerender({ id: undefined });

    await waitFor(() =>
      expect(supabaseMock.removeChannel).toHaveBeenCalledWith(supabaseMock),
    );
    expect(supabaseMock.channel).toHaveBeenCalledOnce();
  });
});
