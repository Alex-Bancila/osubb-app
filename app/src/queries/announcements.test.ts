import { answered } from '../test/postgrest-fake';
import {
  QueryClient,
  QueryClientProvider,
  type InfiniteData,
} from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { supabase } from '../lib/supabase';
import {
  ANNOUNCEMENT_PAGE,
  announcementFeedQueryOptions,
  fetchAnnouncement,
  fetchAnnouncementFeedPage,
  fetchAnnouncementFeedSummary,
  markAnnouncementRead,
  useAnnouncement,
  useAnnouncementFeed,
  useAnnouncementFeedSummary,
  type AnnouncementFeedPage,
  type AnnouncementFeedRpcRow,
  type RawAnnouncementRow,
  createAnnouncement,
  fetchAnnouncementReaders,
  fetchUnreadAnnouncementsCount,
  markAnnouncementReadMutationOptions,
  unreadAnnouncementsCountQueryOptions,
  AnnouncementRefusedError,
  deleteAnnouncement,
  deleteAnnouncementMutationOptions,
  isAnnouncementRefusal,
  updateAnnouncement,
  updateAnnouncementMutationOptions,
  setAnnouncementPinned,
  setAnnouncementPinnedMutationOptions,
  useAnnouncementReaders,
} from './announcements';
import { keys } from './keys';
import { useLiveChanges } from './live-changes';

vi.mock('../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'm1' } } }),
}));
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));
// The org:changes topic as `useLiveChanges` joins it: a test sends a change
// by hand.
const live = vi.hoisted(() => ({
  onChange: (() => undefined) as (table: string) => void,
}));
vi.mock('./live-changes-channel', () => ({
  subscribe: (handlers: { onChange: (table: string) => void }) => {
    live.onChange = handlers.onChange;
    return () => undefined;
  },
}));

const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;
const from = supabase.from as unknown as ReturnType<typeof vi.fn>;

/** One `announcement_feed` row, as the server sends it. */
function feedRpcRow(
  overrides: Partial<AnnouncementFeedRpcRow> = {},
): AnnouncementFeedRpcRow {
  return {
    id: 1,
    title: 'Ședință',
    body: 'Detalii',
    group_id: 10,
    audience: 'local',
    priority: 'normal',
    pinned: false,
    links: [],
    published_at: '2026-10-01T10:00:00Z',
    deadline: null,
    min_level: 0,
    created_by: 'author-1',
    approval_status: 'approved',
    rejection_reason: null,
    read_at: null,
    total: 1,
    ...overrides,
  };
}

/** `count` rows from `firstId` on, each carrying `total`. */
function feedRpcRows(firstId: number, count: number, total: number) {
  return Array.from({ length: count }, (_, index) =>
    feedRpcRow({ id: firstId + index, total }),
  );
}

/** A loaded feed row, as the page holds it. */
function loadedRow(id: number, readAt: string | null = null) {
  return {
    ...feedRpcRow({ id }),
    announcement_reads: readAt ? [{ read_at: readAt }] : [],
  } as unknown as RawAnnouncementRow;
}

/** A request the test answers when it chooses to. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function hookWrapper(
  client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  }),
) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

describe('the Anunțuri feed, read by the page (R56)', () => {
  beforeEach(() => {
    rpc.mockReset();
    from.mockReset();
  });

  describe('fetchAnnouncementFeedPage', () => {
    it('asks announcement_feed for 20 rows after the offset, under the filters', async () => {
      rpc.mockResolvedValue({
        data: [
          feedRpcRow({ id: 9, total: 45, read_at: '2026-10-02T08:00:00Z' }),
          feedRpcRow({ id: 8, total: 45 }),
        ],
        error: null,
      });

      const page = await fetchAnnouncementFeedPage(
        { p_group_id: 3, p_preferred: true },
        20,
      );

      expect(ANNOUNCEMENT_PAGE).toBe(20);
      expect(rpc).toHaveBeenCalledWith('announcement_feed', {
        p_group_id: 3,
        p_preferred: true,
        p_limit: 20,
        p_offset: 20,
      });
      expect(page.total).toBe(45);
      // The reader's own read time becomes the embed the cards read.
      expect(page.rows).toEqual([
        {
          ...feedRpcRow({ id: 9 }),
          read_at: undefined,
          total: undefined,
          announcement_reads: [{ read_at: '2026-10-02T08:00:00Z' }],
        },
        {
          ...feedRpcRow({ id: 8 }),
          read_at: undefined,
          total: undefined,
          announcement_reads: [],
        },
      ]);
      expect(page.rows[0]).not.toHaveProperty('total');
      expect(page.rows[0]).not.toHaveProperty('read_at');
    });

    it('counts nothing when the page is empty', async () => {
      rpc.mockResolvedValue({ data: [], error: null });
      await expect(fetchAnnouncementFeedPage({}, 0)).resolves.toEqual({
        rows: [],
        total: 0,
      });
      expect(rpc).toHaveBeenCalledWith('announcement_feed', {
        p_limit: 20,
        p_offset: 0,
      });
    });

    it('propagates a failure', async () => {
      const error = { code: '42501', message: 'denied' };
      rpc.mockResolvedValue({ data: null, error });
      await expect(fetchAnnouncementFeedPage({}, 0)).rejects.toBe(error);
    });
  });

  describe('announcementFeedQueryOptions', () => {
    const options = announcementFeedQueryOptions({ p_preferred: true }, 'm1');
    const page = (count: number, total: number): AnnouncementFeedPage => ({
      rows: Array.from({ length: count }, (_, index) => loadedRow(index + 1)),
      total,
    });

    it('keeps every page of the member’s feed under one key per filter', () => {
      expect(options.queryKey).toEqual(
        keys.announcements.feed('m1', { p_preferred: true }),
      );
      expect(options.queryKey.slice(0, 2)).toEqual(keys.announcements.feedAll);
    });

    it('asks for the page after the rows already read', () => {
      const first = page(20, 45);
      expect(options.initialPageParam).toBe(0);
      expect(options.getNextPageParam(first, [first])).toBe(20);
      expect(options.getNextPageParam(first, [first, first])).toBe(40);
    });

    it('stops when every Announcement is read, or a page comes back empty', () => {
      const first = page(20, 21);
      const last = page(1, 21);
      expect(options.getNextPageParam(last, [first, last])).toBeUndefined();
      const empty = page(0, 0);
      expect(options.getNextPageParam(empty, [first, empty])).toBeUndefined();
    });
  });

  describe('fetchAnnouncementFeedSummary', () => {
    it('reads what the page shows around the feed', async () => {
      rpc.mockResolvedValue({
        data: [{ unread: 4, critical_id: 9, everything: 30, preferred: 25 }],
        error: null,
      });
      await expect(
        fetchAnnouncementFeedSummary({ p_group_id: 3, p_preferred: true }),
      ).resolves.toEqual({
        unread: 4,
        criticalId: 9,
        everything: 30,
        preferred: 25,
      });
      expect(rpc).toHaveBeenCalledWith('announcement_feed_summary', {
        p_group_id: 3,
        p_preferred: true,
      });
    });

    it('has no banner without an unread critical Announcement', async () => {
      rpc.mockResolvedValue({
        data: [{ unread: 0, critical_id: null, everything: 2, preferred: 2 }],
        error: null,
      });
      await expect(fetchAnnouncementFeedSummary({})).resolves.toEqual({
        unread: 0,
        criticalId: null,
        everything: 2,
        preferred: 2,
      });
    });

    it('propagates a failure', async () => {
      const error = { code: '08006', message: 'offline' };
      rpc.mockResolvedValue({ data: null, error });
      await expect(fetchAnnouncementFeedSummary({})).rejects.toBe(error);
    });
  });

  describe('fetchAnnouncement', () => {
    function answer(result: { data: unknown; error: unknown }) {
      const chain = {
        select: vi.fn(),
        eq: vi.fn(),
        maybeSingle: vi.fn().mockResolvedValue(result),
      };
      chain.select.mockReturnValue(chain);
      chain.eq.mockReturnValue(chain);
      from.mockReturnValue(chain);
      return chain;
    }

    it('reads one Announcement through RLS, with the reader’s own read', async () => {
      const row = loadedRow(7, '2026-10-02T08:00:00Z');
      const chain = answer({ data: row, error: null });

      await expect(fetchAnnouncement(7)).resolves.toBe(row);

      expect(from).toHaveBeenCalledWith('announcements');
      const fields = chain.select.mock.calls[0]?.[0] as string;
      for (const field of [
        'group_id',
        'audience',
        'approval_status',
        'announcement_reads',
      ])
        expect(fields).toContain(field);
      // R45: a Deal never opens as an Announcement.
      expect(chain.eq).toHaveBeenCalledWith('kind', 'announcement');
      expect(chain.eq).toHaveBeenCalledWith('id', 7);
    });

    it('answers null for one the member may not read', async () => {
      answer({ data: null, error: null });
      await expect(fetchAnnouncement(7)).resolves.toBeNull();
    });

    it('propagates a failure instead of calling it unreadable', async () => {
      const error = { code: '08006', message: 'offline' };
      answer({ data: null, error });
      await expect(fetchAnnouncement(7)).rejects.toBe(error);
    });
  });

  describe('useAnnouncementFeed', () => {
    it('is pending until the first page lands, then has its rows, the total and more to read', async () => {
      const first = deferred<{ data: AnnouncementFeedRpcRow[]; error: null }>();
      rpc.mockReturnValue(first.promise);
      const { result } = renderHook(() => useAnnouncementFeed({}, true), {
        wrapper: hookWrapper(),
      });
      expect(result.current.isPending).toBe(true);
      expect(result.current.rows).toEqual([]);
      expect(result.current.total).toBeUndefined();
      first.resolve({ data: feedRpcRows(1, 20, 45), error: null });
      await waitFor(() => expect(result.current.isPending).toBe(false));
      expect(result.current.rows).toHaveLength(20);
      expect(result.current.total).toBe(45);
      expect(result.current.hasMore).toBe(true);
      expect(result.current.isError).toBe(false);
    });

    it('keeps an Announcement once when it appears on two pages', async () => {
      rpc
        .mockResolvedValueOnce({ data: feedRpcRows(1, 20, 45), error: null })
        // One was published meanwhile: the next page starts one row early.
        .mockResolvedValueOnce({ data: feedRpcRows(20, 20, 46), error: null });
      const { result } = renderHook(() => useAnnouncementFeed({}, true), {
        wrapper: hookWrapper(),
      });
      await waitFor(() => expect(result.current.rows).toHaveLength(20));
      act(() => result.current.loadMore());
      await waitFor(() => expect(result.current.rows).toHaveLength(39));
      expect(result.current.rows.map((row) => row.id)).toEqual(
        Array.from({ length: 39 }, (_, index) => index + 1),
      );
      // The next page starts after the rows read, not after the ids kept.
      expect(rpc.mock.calls.map(([, args]) => args.p_offset)).toEqual([0, 20]);
    });

    it('keeps the rows and says so when a later page fails; loading more asks again', async () => {
      rpc
        .mockResolvedValueOnce({ data: feedRpcRows(1, 20, 45), error: null })
        .mockResolvedValueOnce({ data: null, error: new Error('offline') })
        .mockResolvedValueOnce({ data: feedRpcRows(21, 20, 45), error: null });
      const { result } = renderHook(() => useAnnouncementFeed({}, true), {
        wrapper: hookWrapper(),
      });
      await waitFor(() => expect(result.current.rows).toHaveLength(20));
      act(() => result.current.loadMore());
      await waitFor(() => expect(result.current.moreFailed).toBe(true));
      expect(result.current.rows).toHaveLength(20);
      expect(result.current.isError).toBe(false);
      act(() => result.current.loadMore());
      await waitFor(() => expect(result.current.rows).toHaveLength(40));
      expect(result.current.moreFailed).toBe(false);
    });

    it('reports a failed first page as the error it is', async () => {
      const error = new Error('offline');
      rpc.mockResolvedValue({ data: null, error });
      const { result } = renderHook(() => useAnnouncementFeed({}, true), {
        wrapper: hookWrapper(),
      });
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toBe(error);
      expect(result.current.isPending).toBe(false);
      expect(result.current.rows).toEqual([]);
    });

    // Fails if a live change on `announcements` only invalidates the
    // family: the feed then reads every loaded page again, and a next page
    // asked meanwhile would land on top of the old first page.
    it('reads only its first page again after a change, and the next page only once that has landed', async () => {
      const fresh = deferred<{ data: AnnouncementFeedRpcRow[]; error: null }>();
      let changed = false;
      rpc.mockImplementation((_name: string, args: { p_offset: number }) =>
        changed && args.p_offset === 0
          ? fresh.promise
          : Promise.resolve({
              data: feedRpcRows(args.p_offset + 1, 20, 80),
              error: null,
            }),
      );
      const offsets = () => rpc.mock.calls.map(([, args]) => args.p_offset);
      const { result } = renderHook(
        () => {
          useLiveChanges('m1');
          return useAnnouncementFeed({}, true);
        },
        { wrapper: hookWrapper() },
      );
      await waitFor(() => expect(result.current.rows).toHaveLength(20));
      act(() => result.current.loadMore());
      await waitFor(() => expect(result.current.rows).toHaveLength(40));
      // An Announcement is published elsewhere.
      changed = true;
      act(() => live.onChange('announcements'));
      await waitFor(() => expect(offsets()).toEqual([0, 20, 0]));
      await waitFor(() => expect(result.current.rows).toHaveLength(20));
      // The end of the list comes into view meanwhile: nothing is asked.
      act(() => result.current.loadMore());
      expect(offsets()).toEqual([0, 20, 0]);
      expect(result.current.isFetching).toBe(true);
      await act(async () => {
        fresh.resolve({
          data: [feedRpcRow({ id: 500, total: 81 }), ...feedRpcRows(1, 19, 81)],
          error: null,
        });
        await fresh.promise;
      });
      await waitFor(() => expect(result.current.isFetching).toBe(false));
      expect(result.current.rows[0]?.id).toBe(500);
      expect(result.current.total).toBe(81);
      act(() => result.current.loadMore());
      await waitFor(() => expect(result.current.rows).toHaveLength(40));
      expect(offsets()).toEqual([0, 20, 0, 20]);
    });

    it('asks nothing while it is not enabled', () => {
      const { result } = renderHook(() => useAnnouncementFeed({}, false), {
        wrapper: hookWrapper(),
      });
      expect(rpc).not.toHaveBeenCalled();
      expect(result.current).toMatchObject({
        rows: [],
        isPending: false,
        isError: false,
        hasMore: false,
      });
    });
  });

  describe('useAnnouncementFeedSummary', () => {
    it('reads the summary under the page’s filters', async () => {
      rpc.mockResolvedValue({
        data: [{ unread: 2, critical_id: 5, everything: 9, preferred: 7 }],
        error: null,
      });
      const { result } = renderHook(
        () => useAnnouncementFeedSummary({ p_preferred: true }, true),
        { wrapper: hookWrapper() },
      );
      await waitFor(() =>
        expect(result.current.data).toEqual({
          unread: 2,
          criticalId: 5,
          everything: 9,
          preferred: 7,
        }),
      );
      expect(rpc).toHaveBeenCalledWith('announcement_feed_summary', {
        p_preferred: true,
      });
    });

    it('asks nothing while it is not enabled', () => {
      renderHook(() => useAnnouncementFeedSummary({}, false), {
        wrapper: hookWrapper(),
      });
      expect(rpc).not.toHaveBeenCalled();
    });
  });

  describe('useAnnouncement', () => {
    it('reads one Announcement by its id, and nothing without one', async () => {
      const row = loadedRow(7);
      const chain = {
        select: vi.fn(),
        eq: vi.fn(),
        maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
      };
      chain.select.mockReturnValue(chain);
      chain.eq.mockReturnValue(chain);
      from.mockReturnValue(chain);
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });

      renderHook(() => useAnnouncement(null), { wrapper: hookWrapper(client) });
      expect(from).not.toHaveBeenCalled();

      const { result } = renderHook(() => useAnnouncement(7), {
        wrapper: hookWrapper(client),
      });
      await waitFor(() => expect(result.current.data).toBe(row));
      expect(client.getQueryData(keys.announcements.one(7, 'm1'))).toBe(row);
    });
  });

  describe('marking an Announcement read (R56)', () => {
    const filters = { p_preferred: true };
    const feedKey = keys.announcements.feed('m1', filters);

    function loadedFeed(client: QueryClient) {
      client.setQueryData<InfiniteData<AnnouncementFeedPage, number>>(feedKey, {
        pages: [
          {
            rows: [loadedRow(1), loadedRow(2, '2026-10-01T09:00:00Z')],
            total: 3,
          },
          { rows: [loadedRow(3)], total: 3 },
        ],
        pageParams: [0, 2],
      });
    }

    // Fails if marking read invalidates the feed pages: an infinite query
    // reads every loaded page again, and the R15 order would move rows
    // between pages while they load.
    it('marks the row read where it is, never reordering or reading the pages again', async () => {
      const client = new QueryClient();
      loadedFeed(client);

      await markAnnouncementReadMutationOptions(client, 'm1').onSuccess(
        undefined,
        3,
      );

      const feed =
        client.getQueryData<InfiniteData<AnnouncementFeedPage, number>>(
          feedKey,
        );
      expect(feed?.pages.map((page) => page.rows.map((row) => row.id))).toEqual(
        [[1, 2], [3]],
      );
      expect(feed?.pages[1]?.rows[0]?.announcement_reads).toEqual([
        { read_at: expect.any(String) },
      ]);
      // Every other row stays as it was, a read one keeps its time.
      expect(feed?.pages[0]?.rows[0]?.announcement_reads).toEqual([]);
      expect(feed?.pages[0]?.rows[1]?.announcement_reads).toEqual([
        { read_at: '2026-10-01T09:00:00Z' },
      ]);
      expect(client.getQueryState(feedKey)?.isInvalidated).toBe(false);
    });

    it('marks the one read by its id too, and refreshes everything else the read changes', async () => {
      const client = new QueryClient();
      loadedFeed(client);
      client.setQueryData(keys.announcements.one(3, 'm1'), loadedRow(3));
      client.setQueryData(keys.announcements.feedSummary('m1', filters), {
        unread: 2,
        criticalId: null,
        everything: 3,
        preferred: 3,
      });
      client.setQueryData(keys.announcements.unread('m1'), 2);
      client.setQueryData([...keys.announcements.unread('m1'), 'deal'], 1);
      client.setQueryData(keys.announcements.readers(3, 'm1'), []);
      client.setQueryData(keys.announcements.deals('m1'), []);
      client.setQueryData(keys.notifications.list('m1'), []);
      client.setQueryData(keys.notifications.unread('m1'), 1);

      await markAnnouncementReadMutationOptions(client, 'm1').onSuccess(
        undefined,
        3,
      );

      expect(
        client.getQueryData<RawAnnouncementRow>(keys.announcements.one(3, 'm1'))
          ?.announcement_reads,
      ).toEqual([{ read_at: expect.any(String) }]);
      for (const key of [
        keys.announcements.feedSummary('m1', filters),
        keys.announcements.unread('m1'),
        [...keys.announcements.unread('m1'), 'deal'],
        keys.announcements.readers(3, 'm1'),
        keys.announcements.deals('m1'),
        keys.announcements.one(3, 'm1'),
        keys.notifications.list('m1'),
        keys.notifications.unread('m1'),
      ])
        expect(client.getQueryState(key)?.isInvalidated).toBe(true);
      expect(client.getQueryState(feedKey)?.isInvalidated).toBe(false);
    });
  });
});

describe('announcements query layer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts without RETURNING, so a global writer can publish a local row outside their read audience', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const select = vi.fn();
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      insert,
      select,
    });
    const payload = {
      title: 'Ședință',
      body: 'Detalii',
      group_id: 12,
      audience: 'local',
    };
    await createAnnouncement(payload);
    expect(insert).toHaveBeenCalledWith(payload);
    expect(select).not.toHaveBeenCalled();
  });

  describe('setAnnouncementPinned (#857)', () => {
    function answer(result: { data: unknown; error: unknown }) {
      const select = vi.fn().mockResolvedValue(result);
      const eq = vi.fn().mockReturnValue({ select });
      const update = vi.fn().mockReturnValue({ eq });
      (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        update,
      });
      return { update, eq, select };
    }

    it('sends only { pinned } for the id and reads the row back', async () => {
      const { update, eq, select } = answer({
        data: [{ id: 5 }],
        error: null,
      });
      await setAnnouncementPinned({ id: 5, pinned: true });
      expect(supabase.from).toHaveBeenCalledWith('announcements');
      expect(update).toHaveBeenCalledWith({ pinned: true });
      expect(eq).toHaveBeenCalledWith('id', 5);
      expect(select).toHaveBeenCalledWith('id');
    });

    it('reads zero rows back as a refusal', async () => {
      answer({ data: [], error: null });
      await expect(
        setAnnouncementPinned({ id: 5, pinned: false }),
      ).rejects.toBeInstanceOf(AnnouncementRefusedError);
    });

    it('throws a server error as it is', async () => {
      answer({ data: null, error: { code: '23514', message: 'x' } });
      await expect(
        setAnnouncementPinned({ id: 5, pinned: true }),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('invalidates the feed and the unread count on success', async () => {
      const queryClient = new QueryClient();
      queryClient.setQueryData(keys.announcements.feed('m1', {}), []);
      queryClient.setQueryData(keys.announcements.unread('m1'), 2);
      await setAnnouncementPinnedMutationOptions(queryClient).onSuccess();
      for (const key of [
        keys.announcements.feed('m1', {}),
        keys.announcements.unread('m1'),
      ])
        expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    });
  });

  describe('updateAnnouncement and deleteAnnouncement (#930)', () => {
    function answer(result: { data: unknown; error: unknown }) {
      const select = vi.fn().mockResolvedValue(result);
      const eq = vi.fn().mockReturnValue({ select });
      const update = vi.fn().mockReturnValue({ eq });
      const remove = vi.fn().mockReturnValue({ eq });
      (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        update,
        delete: remove,
      });
      return { update, remove, eq, select };
    }

    it('updates only the changed fields of the id and reads the row back', async () => {
      const { update, eq, select } = answer({ data: [{ id: 5 }], error: null });
      await updateAnnouncement({ id: 5, changes: { title: 'Nou' } });
      expect(supabase.from).toHaveBeenCalledWith('announcements');
      expect(update).toHaveBeenCalledWith({ title: 'Nou' });
      expect(eq).toHaveBeenCalledWith('id', 5);
      expect(select).toHaveBeenCalledWith('id');
    });

    it('deletes the id and reads the row back', async () => {
      const { remove, eq, select } = answer({ data: [{ id: 5 }], error: null });
      await deleteAnnouncement(5);
      expect(remove).toHaveBeenCalledWith();
      expect(eq).toHaveBeenCalledWith('id', 5);
      expect(select).toHaveBeenCalledWith('id');
    });

    it('reads zero rows back as a refusal, and so does 42501', async () => {
      answer({ data: [], error: null });
      await expect(
        updateAnnouncement({ id: 5, changes: { body: 'x' } }),
      ).rejects.toBeInstanceOf(AnnouncementRefusedError);
      await expect(deleteAnnouncement(5)).rejects.toBeInstanceOf(
        AnnouncementRefusedError,
      );
      expect(isAnnouncementRefusal(new AnnouncementRefusedError())).toBe(true);
      expect(isAnnouncementRefusal({ code: '42501' })).toBe(true);
      expect(isAnnouncementRefusal({ code: '23514' })).toBe(false);
    });

    it('invalidates the feed and the unread count on success', async () => {
      for (const options of [
        updateAnnouncementMutationOptions,
        deleteAnnouncementMutationOptions,
      ]) {
        const queryClient = new QueryClient();
        queryClient.setQueryData(keys.announcements.feed('m1', {}), []);
        queryClient.setQueryData(keys.announcements.unread('m1'), 2);
        await options(queryClient).onSuccess();
        for (const key of [
          keys.announcements.feed('m1', {}),
          keys.announcements.unread('m1'),
        ])
          expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
      }
    });
  });

  describe('markAnnouncementRead', () => {
    it('upserts announcement_reads row with ignoreDuplicates', async () => {
      const mockUpsert = vi.fn().mockResolvedValue({
        error: null,
      });

      (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        upsert: mockUpsert,
      });

      await markAnnouncementRead({
        announcementId: 42,
        memberId: 'm-100',
      });

      expect(supabase.from).toHaveBeenCalledWith('announcement_reads');
      expect(mockUpsert).toHaveBeenCalledWith(
        {
          announcement_id: 42,
          member_id: 'm-100',
        },
        {
          onConflict: 'announcement_id,member_id',
          ignoreDuplicates: true,
        },
      );
    });

    it('throws error when upsert fails', async () => {
      const mockUpsert = vi.fn().mockResolvedValue({
        error: { code: '42501', message: 'forbidden' },
      });

      (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        upsert: mockUpsert,
      });

      await expect(
        markAnnouncementRead({
          announcementId: 42,
          memberId: 'm-100',
        }),
      ).rejects.toEqual({ code: '42501', message: 'forbidden' });
    });
  });

  describe('unread announcements count', () => {
    it('asks the server for the count the badge shows', async () => {
      rpc.mockResolvedValue({ data: 4, error: null });

      await expect(fetchUnreadAnnouncementsCount()).resolves.toBe(4);
      expect(rpc).toHaveBeenCalledWith('my_unread_announcements_count');
      expect(unreadAnnouncementsCountQueryOptions('m1').queryKey).toEqual(
        keys.announcements.unread('m1'),
      );
    });

    it('is invalidated by marking an Announcement read', async () => {
      const queryClient = new QueryClient();
      queryClient.setQueryData(keys.announcements.unread('m1'), 4);
      const options = markAnnouncementReadMutationOptions(queryClient, 'm1');

      await options.onSuccess(undefined, 42);

      expect(
        queryClient.getQueryState(keys.announcements.unread('m1'))
          ?.isInvalidated,
      ).toBe(true);
    });
  });

  describe('fetchAnnouncementReaders', () => {
    it('answers null on PT404, so the readers line stays hidden', async () => {
      (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        answered({
          data: null,
          error: { code: 'PT404', message: 'announcement_not_found' },
        }),
      );

      await expect(fetchAnnouncementReaders(7)).resolves.toBeNull();
      expect(supabase.rpc).toHaveBeenCalledWith('announcement_readers', {
        p_announcement_id: 7,
      });
    });

    it('throws any other failure', async () => {
      (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        answered({
          data: null,
          error: { code: '08006', message: 'connection failure' },
        }),
      );

      await expect(fetchAnnouncementReaders(7)).rejects.toMatchObject({
        code: '08006',
      });
    });

    it('names every recipient from the directory, unread ones with a null time', async () => {
      (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        answered({
          data: [
            { member_id: 'a', read_at: '2026-09-20T10:00:00Z' },
            { member_id: 'b', read_at: null },
          ],
          error: null,
        }),
      );
      const inIds = vi.fn().mockResolvedValue({
        data: [
          {
            id: 'a',
            full_name: 'Ana Pop',
            nickname: 'Ani',
            avatar_color: null,
          },
        ],
        error: null,
      });
      const select = vi.fn().mockReturnValue({ in: inIds });
      (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        select,
      });

      const readers = await fetchAnnouncementReaders(7);

      expect(supabase.from).toHaveBeenCalledWith('profiles_directory');
      expect(inIds).toHaveBeenCalledWith('id', ['a', 'b']);
      expect(readers).toEqual([
        {
          member: {
            memberId: 'a',
            nickname: 'Ani',
            fullName: 'Ana Pop',
            avatarColor: null,
          },
          readAt: '2026-09-20T10:00:00Z',
        },
        { member: { memberId: 'b', fullName: 'Membru OSUBB' }, readAt: null },
      ]);
    });
  });
});

/* Audit D-4: the readers list stayed "Citit de 0 din 3" all session. */
describe('the readers list stays current', () => {
  it('asks again every time the list is opened, whatever the cache holds', async () => {
    rpc.mockReset().mockReturnValue(answered({ data: [], error: null }));
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: 30_000, retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);

    const first = renderHook(() => useAnnouncementReaders(7, true), {
      wrapper,
    });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();
    const second = renderHook(() => useAnnouncementReaders(7, true), {
      wrapper,
    });
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    second.unmount();
  });

  it('marking read refreshes the readers list and the notifications', async () => {
    const client = new QueryClient();
    client.setQueryData(keys.announcements.readers(7, 'm1'), []);
    client.setQueryData(keys.notifications.list('m1'), []);
    client.setQueryData(keys.notifications.unread('m1'), 2);
    await markAnnouncementReadMutationOptions(client, 'm1').onSuccess(
      undefined,
      7,
    );

    for (const key of [
      keys.announcements.readers(7, 'm1'),
      keys.notifications.list('m1'),
      keys.notifications.unread('m1'),
    ])
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  });
});
