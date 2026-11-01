import {
  QueryClient,
  QueryClientProvider,
  useInfiniteQuery,
  type InfiniteData,
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

  // R58: a new Points Start Date changes every total a page shows.
  it('a change of the evaluation settings refreshes the evaluation, points and campaign families', async () => {
    const { invalidate } = setup();
    const { onChange } = await joined();

    act(() =>
      onChange({ payload: { table: 'evaluation_settings', op: 'UPDATE' } }),
    );

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: keys.evaluation.all,
      }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.points.all });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.campaigns.all });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: keys.tasks.all });
  });

  // R58: Retention Signals are stored rows the page reads, not a derivation.
  it('a change of the Retention Signals refreshes the evaluation family and nothing else', async () => {
    const { invalidate } = setup();
    const { onChange } = await joined();

    act(() =>
      onChange({ payload: { table: 'retention_signals', op: 'INSERT' } }),
    );

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: keys.evaluation.all,
      }),
    );
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: keys.points.all });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: keys.tasks.all });
  });

  // R58 dropped the Promotion Rules: their table is no longer a signal.
  it('no longer watches promotion_rules', async () => {
    const { invalidate } = setup();
    const { onChange } = await joined();

    act(() =>
      onChange({ payload: { table: 'promotion_rules', op: 'UPDATE' } }),
    );
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(invalidate).not.toHaveBeenCalled();
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

  describe('the finished part of a Task list, read by the page (#1053, #1135)', () => {
    /** The `p_offset` of every `task_list` request, in order. */
    const taskListOffsets = () =>
      supabaseMock.rpc.mock.calls
        .filter(([name]) => name === 'task_list')
        .map(([, args]) => (args as { p_offset: number }).p_offset);

    /**
     * De gestionat's finished part with `count` of its pages loaded (300
     * finished Tasks, 50 a page); `listed` false disables the list's
     * observer, so the query is inactive, as for a tab the Member left.
     */
    async function pagesLoaded(count: number) {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      );
      supabaseMock.rpc.mockImplementation(
        (_name: string, args: { p_offset: number }) =>
          Promise.resolve({
            data: Array.from({ length: FINISHED_PAGE }, (_, index) => ({
              id: args.p_offset + index + 1,
              executor: null,
              total: 300,
            })),
            error: null,
          }),
      );
      const options = finishedTasksQueryOptions('managed', {}, memberId);
      const { result, rerender } = renderHook(
        ({ listed }: { listed: boolean }) => {
          useLiveChanges(memberId);
          return useInfiniteQuery({ ...options, enabled: listed });
        },
        { wrapper, initialProps: { listed: true } },
      );
      await waitFor(() => expect(result.current.data?.pages).toHaveLength(1));
      for (let page = 2; page <= count; page += 1) {
        await act(() => result.current.fetchNextPage());
        await waitFor(() =>
          expect(result.current.data?.pages).toHaveLength(page),
        );
      }
      expect(taskListOffsets()).toEqual(
        Array.from({ length: count }, (_, index) => index * FINISHED_PAGE),
      );
      return { result, rerender, queryClient, queryKey: options.queryKey };
    }

    // Fails if a change cuts the list to its first page: a Member scrolled
    // to page 3 of Taskuri încheiate would lose their place over any Task
    // started anywhere.
    it('keeps the loaded pages after a change and reads each again in place', async () => {
      const { result } = await pagesLoaded(3);
      const { onChange } = await joined();

      act(() => onChange({ payload: { table: 'tasks', op: 'UPDATE' } }));

      await waitFor(() => expect(taskListOffsets()).toHaveLength(6));
      await waitFor(() => expect(result.current.isFetching).toBe(false));
      expect(taskListOffsets()).toEqual([0, 50, 100, 0, 50, 100]);
      expect(result.current.data?.pages).toHaveLength(3);
      expect(result.current.hasNextPage).toBe(true);
    });

    // Fails if every loaded page is read again: a change would cost one
    // request per page, however deep the Member scrolled.
    it('keeps at most three pages: beyond the cap, the rest are dropped', async () => {
      const { result } = await pagesLoaded(5);
      const { onChange } = await joined();

      act(() => onChange({ payload: { table: 'tasks', op: 'UPDATE' } }));

      await waitFor(() => expect(taskListOffsets()).toHaveLength(8));
      await waitFor(() => expect(result.current.isFetching).toBe(false));
      expect(taskListOffsets()).toEqual([0, 50, 100, 150, 200, 0, 50, 100]);
      expect(result.current.data?.pages).toHaveLength(3);
      expect(result.current.hasNextPage).toBe(true);
    });

    // Fails if an inactive list keeps its pages: a tab the Member left would
    // read three pages again the moment they came back.
    it('cuts a list nobody is looking at to its first page', async () => {
      const { rerender, queryClient, queryKey } = await pagesLoaded(3);
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
      const { onChange } = await joined();
      rerender({ listed: false });

      act(() => onChange({ payload: { table: 'tasks', op: 'UPDATE' } }));

      await waitFor(() =>
        expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.tasks.all }),
      );
      // Nothing is read for an inactive list; its first page waits.
      expect(taskListOffsets()).toEqual([0, 50, 100]);
      expect(
        queryClient.getQueryData<InfiniteData<unknown>>(queryKey)?.pages,
      ).toHaveLength(1);
    });

    // Fails if a hidden document keeps its pages: a phone in a pocket would
    // read three pages again on every change.
    it('cuts a list in a hidden document to its first page', async () => {
      const { result } = await pagesLoaded(3);
      const { onChange } = await joined();
      const hidden = vi
        .spyOn(document, 'visibilityState', 'get')
        .mockReturnValue('hidden');
      try {
        act(() => onChange({ payload: { table: 'tasks', op: 'UPDATE' } }));

        await waitFor(() => expect(taskListOffsets()).toHaveLength(4));
        await waitFor(() => expect(result.current.isFetching).toBe(false));
        expect(taskListOffsets()).toEqual([0, 50, 100, 0]);
        expect(result.current.data?.pages).toHaveLength(1);
      } finally {
        hidden.mockRestore();
      }
    });

    // Fails if a reconnect cuts the list: signals may have been missed, but
    // the Member's place is kept the same way.
    it('keeps the loaded pages after a reconnect too', async () => {
      const { result } = await pagesLoaded(3);
      const { onStatus } = await joined();

      act(() => onStatus('SUBSCRIBED'));
      act(() => onStatus('CHANNEL_ERROR'));
      act(() => onStatus('SUBSCRIBED'));

      await waitFor(() => expect(taskListOffsets()).toHaveLength(6));
      await waitFor(() => expect(result.current.isFetching).toBe(false));
      expect(taskListOffsets()).toEqual([0, 50, 100, 0, 50, 100]);
      expect(result.current.data?.pages).toHaveLength(3);
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
