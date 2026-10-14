import { useMemo } from 'react';
import {
  skipToken,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';

import { useAuth } from '../lib/auth';
import type { Database, Json } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import { readAllRows } from './read-all';
import { keys } from './keys';
import { fetchMemberIdentities } from './member-identities';
import type { AnnouncementChanges } from '../screens/announcements/announcement-draft';
import type {
  AnnouncementReader,
  RawAnnouncementRow,
} from '../screens/announcements/announcements-presentation';

const ANNOUNCEMENT_FIELDS = `
  id,
  title,
  body,
  group_id,
  audience,
  priority,
  pinned,
  links,
  published_at,
  deadline,
  min_level,
  created_by,
  approval_status,
  rejection_reason,
  announcement_reads (
    read_at
  )
`;

export type MarkAnnouncementReadInput = {
  announcementId: number;
  memberId: string;
};

export type {
  RawAnnouncementRow,
  RawAnnouncementRow as AnnouncementFeedRow,
} from '../screens/announcements/announcements-presentation';

/*
 * Anunțuri by the page (ruling R56, spec 2026-10-14 member reads, part 4).
 * The server reads the feed: what the Member reads (exactly
 * `announcements_read`, never a Deal), narrowed by Grupuri preferate (R43)
 * and the Group filter, in R15's order — pinned, then unread, then read,
 * newest first in each — 20 rows a page with the unpaged count. Around it,
 * `announcement_feed_summary` answers the header's unread count, the
 * critical banner and the empty states, so nothing here counts or orders.
 */

/** How many Announcements one page of the feed holds. */
export const ANNOUNCEMENT_PAGE = 20;

/** What narrows the feed: the Work Filter's Group, Grupuri preferate (R43). */
export type FeedFilters = { p_group_id?: number; p_preferred?: boolean };

/**
 * One `announcement_feed` row. Written out because the generated type of a
 * table-returning function marks every column as never null.
 */
export type AnnouncementFeedRpcRow = {
  id: number;
  title: string;
  body: string;
  group_id: number;
  audience: string;
  priority: Database['public']['Enums']['announce_priority'];
  pinned: boolean;
  links: Json;
  published_at: string;
  deadline: string | null;
  min_level: number;
  created_by: string | null;
  approval_status: string;
  rejection_reason: string | null;
  /** The reader's own read time; null while unread. */
  read_at: string | null;
  total: number;
  /** The moment the page was cut against (`p_as_of`, or the server's now). */
  as_of: string;
};

/**
 * Where a page of the feed starts: after `offset` rows, in R15's order as of
 * `asOf`. Being read moves an Announcement to the read band, so every page
 * of one reading is cut against its first page's moment — a card read in
 * between keeps its place and the next page skips none. `null` starts a
 * reading: the server takes its own now and answers it.
 */
export type FeedPageParam = { offset: number; asOf: string | null };

export type AnnouncementFeedPage = {
  rows: RawAnnouncementRow[];
  total: number;
  /** The moment the page was cut against; the next page passes it on. */
  asOf: string | null;
};

/** A server row as the cards read an Announcement: its read as the embed. */
function feedRow(row: AnnouncementFeedRpcRow): RawAnnouncementRow {
  const { read_at: readAt, total: _total, as_of: _asOf, ...announcement } = row;
  return {
    ...announcement,
    announcement_reads: readAt ? [{ read_at: readAt }] : [],
  } as unknown as RawAnnouncementRow;
}

/**
 * One page of the feed under `filters`, how many the filters match, and the
 * moment it was cut against.
 */
export async function fetchAnnouncementFeedPage(
  filters: FeedFilters,
  { offset, asOf }: FeedPageParam,
): Promise<AnnouncementFeedPage> {
  const { data, error } = await supabase.rpc('announcement_feed', {
    ...filters,
    p_limit: ANNOUNCEMENT_PAGE,
    p_offset: offset,
    ...(asOf === null ? {} : { p_as_of: asOf }),
  });
  if (error) throw error;
  const page = (data ?? []) as unknown as AnnouncementFeedRpcRow[];
  return {
    rows: page.map(feedRow),
    total: page[0]?.total ?? 0,
    asOf: page[0]?.as_of ?? asOf,
  };
}

/**
 * The infinite query of the feed. The next page starts after the rows
 * already read, at the first page's moment, and there is none once they
 * reach `total` or a page comes back empty. A refetch starts again from
 * `initialPageParam` — a new moment — and TanStack recomputes every later
 * page's start from the pages it has just read, so the pages stay one
 * reading.
 */
export function announcementFeedQueryOptions(
  filters: FeedFilters,
  memberId: string | undefined,
) {
  return {
    queryKey: keys.announcements.feed(memberId, filters),
    queryFn: ({ pageParam }: { pageParam: FeedPageParam }) =>
      fetchAnnouncementFeedPage(filters, pageParam),
    initialPageParam: { offset: 0, asOf: null } as FeedPageParam,
    getNextPageParam: (
      lastPage: AnnouncementFeedPage,
      pages: readonly AnnouncementFeedPage[],
    ): FeedPageParam | undefined => {
      const read = pages.reduce((count, page) => count + page.rows.length, 0);
      return lastPage.rows.length > 0 && read < lastPage.total
        ? { offset: read, asOf: pages[0]?.asOf ?? null }
        : undefined;
    },
  } as const;
}

export type AnnouncementFeed = {
  /** The Announcements read so far, each once, in the server's order. */
  rows: RawAnnouncementRow[];
  /** How many the filters match; undefined until the first page lands. */
  total: number | undefined;
  /** The first page is on its way. */
  isPending: boolean;
  /** The first page failed. */
  isError: boolean;
  error: Error | null;
  hasMore: boolean;
  /** The next page is on its way. */
  isLoadingMore: boolean;
  /**
   * Any read of the feed is on its way: the first page, the first page read
   * again after a change, or the next page. No next page is asked meanwhile.
   */
  isFetching: boolean;
  /** A later page failed; the rows read so far stay. */
  moreFailed: boolean;
  /** Asks for the next page, unless a read is on its way. */
  loadMore: () => void;
  refetch: () => void;
};

/** The feed under `filters`, read by the page; nothing is asked while `enabled` is false. */
export function useAnnouncementFeed(
  filters: FeedFilters,
  enabled = true,
): AnnouncementFeed {
  const memberId = useAuth().session?.user.id;
  const asked = Boolean(memberId && enabled);
  const query = useInfiniteQuery({
    ...announcementFeedQueryOptions(filters, memberId),
    enabled: asked,
  });
  const rows = useMemo(() => {
    // One published between two pages shifts the next one: keep the first
    // appearance of each id.
    const seen = new Set<number>();
    const read: RawAnnouncementRow[] = [];
    for (const page of query.data?.pages ?? [])
      for (const row of page.rows)
        if (!seen.has(row.id)) {
          seen.add(row.id);
          read.push(row);
        }
    return read;
  }, [query.data]);
  const firstFailed = query.isError && query.data === undefined;
  return {
    rows,
    total: query.data?.pages[0]?.total,
    isPending: asked && !firstFailed && query.data === undefined,
    isError: asked && firstFailed,
    error: firstFailed ? query.error : null,
    hasMore: asked && query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    isFetching: asked && query.isFetching,
    moreFailed: query.isFetchNextPageError,
    loadMore: () => {
      // After a change the feed keeps its first page and reads it again
      // (live-changes.ts). A next page asked meanwhile would cancel that read
      // and land on top of the old first page; `cancelRefetch: false` also
      // covers a call made from a render before that read began.
      if (query.hasNextPage && !query.isFetching)
        void query.fetchNextPage({ cancelRefetch: false });
    },
    refetch: () => void query.refetch(),
  };
}

/** What the page shows around its feed (`announcement_feed_summary`). */
export type AnnouncementFeedSummary = {
  /** The header's unread count: the view's approved unread ones, whatever the Group filter. */
  unread: number;
  /** The first unread critical Announcement of the list shown, for the banner. */
  criticalId: number | null;
  /** Every Announcement the Member reads. */
  everything: number;
  /** Those of the preferred view (every one when it is not asked). */
  preferred: number;
};

export async function fetchAnnouncementFeedSummary(
  filters: FeedFilters,
): Promise<AnnouncementFeedSummary> {
  const { data, error } = await supabase.rpc(
    'announcement_feed_summary',
    filters,
  );
  if (error) throw error;
  const row = (data ?? [])[0] as
    | {
        unread: number | null;
        critical_id: number | null;
        everything: number | null;
        preferred: number | null;
      }
    | undefined;
  return {
    unread: row?.unread ?? 0,
    criticalId: row?.critical_id ?? null,
    everything: row?.everything ?? 0,
    preferred: row?.preferred ?? 0,
  };
}

/** The summary under the feed's own filters; nothing is asked while `enabled` is false. */
export function useAnnouncementFeedSummary(
  filters: FeedFilters,
  enabled = true,
) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.announcements.feedSummary(memberId, filters),
    queryFn:
      memberId && enabled
        ? () => fetchAnnouncementFeedSummary(filters)
        : skipToken,
  });
}

/**
 * One Announcement by its id, through RLS, with the reader's own read: what
 * a `?anunt=` link, the banner or a Cerere de aprobare opens when the row is
 * not among the loaded pages. `null` when the Member may not read it (or it
 * is gone, or it is a Deal).
 */
export async function fetchAnnouncement(
  id: number,
): Promise<RawAnnouncementRow | null> {
  const { data, error } = await supabase
    .from('announcements')
    .select(ANNOUNCEMENT_FIELDS)
    // A Deal is an Announcement of kind deal (R45); it lives on its own tab.
    .eq('kind', 'announcement')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as unknown as RawAnnouncementRow | null;
}

/** Nothing is asked for a `null` id. */
export function useAnnouncement(id: number | null) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.announcements.one(id ?? 0, memberId),
    queryFn: memberId && id !== null ? () => fetchAnnouncement(id) : skipToken,
  });
}

/**
 * The Anunțuri badge: unread Announcements the Member may read, counted by the
 * server under the same read policy as the feed (#693).
 */
export async function fetchUnreadAnnouncementsCount(): Promise<number> {
  const { data, error } = await supabase.rpc('my_unread_announcements_count');
  if (error) throw error;
  return data ?? 0;
}

export function unreadAnnouncementsCountQueryOptions(memberId?: string) {
  return {
    queryKey: keys.announcements.unread(memberId),
    queryFn: memberId ? fetchUnreadAnnouncementsCount : skipToken,
  } as const;
}

export function useUnreadAnnouncementsCount() {
  const memberId = useAuth().session?.user.id;
  return useQuery(unreadAnnouncementsCountQueryOptions(memberId));
}

/**
 * Who of the Audience has read an Announcement (#693), names resolved from the
 * directory. `null` when the server answers `PT404 announcement_not_found`:
 * the viewer may not see the readers, which hides the line rather than failing.
 */
export async function fetchAnnouncementReaders(
  announcementId: number,
): Promise<AnnouncementReader[] | null> {
  // An org Audience is every active Member: it passes 500. Newest read
  // first, as the server lists them; the id keeps the pages stable.
  const rows = await readAllRows((from, to) =>
    supabase
      .rpc('announcement_readers', { p_announcement_id: announcementId })
      .order('read_at', { ascending: false, nullsFirst: false })
      .order('member_id')
      .range(from, to),
  ).catch((error: unknown) => {
    if ((error as { code?: unknown } | null)?.code === 'PT404') return null;
    throw error;
  });
  if (!rows) return null;
  const identities = await fetchMemberIdentities(
    rows.map((row) => row.member_id),
  );
  return rows.map((row) => ({
    member: identities.get(row.member_id) ?? {
      memberId: row.member_id,
      fullName: 'Membru OSUBB',
    },
    readAt: row.read_at ?? null,
  }));
}

/** Asked only when `enabled` — the viewer might be allowed (`mayAskForReaders`). */
export function useAnnouncementReaders(
  announcementId: number | null,
  enabled: boolean,
) {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.announcements.readers(announcementId ?? 0, memberId),
    queryFn:
      announcementId !== null && memberId && enabled
        ? () => fetchAnnouncementReaders(announcementId)
        : skipToken,
    // Other Members read while this one watches: every opening asks again
    // (Audit D-4), never the half-minute cache.
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

/** No author or date: the server stamps created_by and published_at (security pass M1). */
export type CreateAnnouncementInput = Pick<
  import('../lib/database.types').Database['public']['Tables']['announcements']['Insert'],
  | 'title'
  | 'body'
  | 'group_id'
  | 'audience'
  | 'priority'
  | 'pinned'
  | 'links'
  | 'deadline'
  | 'min_level'
>;

/** No RETURNING: a global writer can post a local item outside their own read audience. */
export async function createAnnouncement(
  input: CreateAnnouncementInput,
): Promise<void> {
  const { error } = await supabase.from('announcements').insert(input);
  if (error) throw error;
}

export function useCreateAnnouncement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createAnnouncement,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.announcements.all });
    },
  });
}

export type SetAnnouncementPinnedInput = { id: number; pinned: boolean };

/**
 * `announcements_update` or `announcements_delete` refused the row: RLS
 * filters it out, so nothing comes back.
 */
export class AnnouncementRefusedError extends Error {
  constructor() {
    super('announcement_refused');
    this.name = 'AnnouncementRefusedError';
  }
}

/** A refusal by `announcements_update` / `_delete`: no row back, or `42501`. */
export function isAnnouncementRefusal(cause: unknown): boolean {
  return (
    cause instanceof AnnouncementRefusedError ||
    (cause as { code?: string } | null)?.code === '42501'
  );
}

export type UpdateAnnouncementInput = {
  id: number;
  /** Only the fields the manager changed (`announcementChanges`). */
  changes: AnnouncementChanges;
};

/**
 * Edit a published Announcement (#930): a direct update under
 * `announcements_update` sending only the changed fields. The authorship
 * trigger keeps the author and date, the reads stay, and the fan-out is
 * `after insert` only, so nobody is notified again.
 */
export async function updateAnnouncement({
  id,
  changes,
}: UpdateAnnouncementInput): Promise<void> {
  const { data, error } = await supabase
    .from('announcements')
    .update(changes)
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new AnnouncementRefusedError();
}

/**
 * Delete an Announcement (#930) under `announcements_delete`; its reads go
 * with it (`on delete cascade`). An old "Anunț nou" notification still links
 * to it and opens the "Anunț indisponibil" state.
 */
export async function deleteAnnouncement(id: number): Promise<void> {
  const { data, error } = await supabase
    .from('announcements')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new AnnouncementRefusedError();
}

/** The feed, the unread badge and the readers all live under `all`. */
function announcementWriteOptions<Input>(
  queryClient: QueryClient,
  mutationFn: (input: Input) => Promise<void>,
) {
  return {
    mutationFn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.announcements.all });
    },
  } as const;
}

export function updateAnnouncementMutationOptions(queryClient: QueryClient) {
  return announcementWriteOptions(queryClient, updateAnnouncement);
}

export function useUpdateAnnouncement() {
  const queryClient = useQueryClient();
  return useMutation(updateAnnouncementMutationOptions(queryClient));
}

export function deleteAnnouncementMutationOptions(queryClient: QueryClient) {
  return announcementWriteOptions(queryClient, deleteAnnouncement);
}

export function useDeleteAnnouncement() {
  const queryClient = useQueryClient();
  return useMutation(deleteAnnouncementMutationOptions(queryClient));
}

/**
 * Pin or unpin a published Announcement (#857). A direct update under
 * `announcements_update`; only `pinned` is sent (the authorship trigger keeps
 * the author and date). An update fires no fan-out — that trigger is
 * `after insert` only — so nobody is notified again. RLS filters a row the
 * caller may not update, so zero rows back means refused.
 */
export async function setAnnouncementPinned({
  id,
  pinned,
}: SetAnnouncementPinnedInput): Promise<void> {
  const { data, error } = await supabase
    .from('announcements')
    .update({ pinned })
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new AnnouncementRefusedError();
}

export function setAnnouncementPinnedMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: setAnnouncementPinned,
    onSuccess: async () => {
      // The feed (and its pinned band) and the unread count live under `all`.
      await queryClient.invalidateQueries({ queryKey: keys.announcements.all });
    },
  } as const;
}

export function useSetAnnouncementPinned() {
  const queryClient = useQueryClient();
  return useMutation(setAnnouncementPinnedMutationOptions(queryClient));
}

/**
 * Mark an announcement as read for the active member.
 * Uses upsert with ignoreDuplicates so repeated or concurrent reads are idempotent.
 */
export async function markAnnouncementRead(
  input: MarkAnnouncementReadInput,
): Promise<void> {
  const { error } = await supabase.from('announcement_reads').upsert(
    {
      announcement_id: input.announcementId,
      member_id: input.memberId,
    },
    {
      onConflict: 'announcement_id,member_id',
      ignoreDuplicates: true,
    },
  );

  if (error) throw error;
}

export function markAnnouncementReadMutationOptions(
  queryClient: QueryClient,
  memberId?: string,
) {
  return {
    mutationFn: (announcementId: number) => {
      if (!memberId) throw new Error('Not authenticated');
      return markAnnouncementRead({
        announcementId,
        memberId,
      });
    },
    onSuccess: async (_: void, announcementId: number) => {
      // R56: the loaded feed marks the row read where it stands. Reading the
      // pages again would reorder them (R15 puts read ones last) and move
      // rows between pages while they load; the order is read again only
      // when the feed is read again from the top.
      const readAt = new Date().toISOString();
      queryClient.setQueriesData<
        InfiniteData<AnnouncementFeedPage, FeedPageParam>
      >(
        { queryKey: keys.announcements.feedAll },
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              rows: page.rows.map((row) =>
                row.id === announcementId ? readRow(row, readAt) : row,
              ),
            })),
          },
      );
      queryClient.setQueryData<RawAnnouncementRow | null>(
        keys.announcements.one(announcementId, memberId),
        (row) => row && readRow(row, readAt),
      );
      // Everything else the read changes, all under `['announcements']`
      // but the feed's pages — the summary, the badges, the readers list,
      // the Deals, the one read by id — and the notifications: reading an
      // Announcement reads its "Anunț nou" notification too (#861, Audit
      // D-4/D-20).
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: keys.announcements.all,
          predicate: (query) => !isFeedPage(query.queryKey),
        }),
        queryClient.invalidateQueries({ queryKey: keys.notifications.all }),
      ]);
    },
  } as const;
}

/** A row as read by its reader: a row already read keeps its own time. */
function readRow(row: RawAnnouncementRow, readAt: string): RawAnnouncementRow {
  return row.announcement_reads?.length
    ? row
    : { ...row, announcement_reads: [{ read_at: readAt }] };
}

/** A page of the feed: under `keys.announcements.feedAll`. */
function isFeedPage(queryKey: QueryKey): boolean {
  return keys.announcements.feedAll.every(
    (part, index) => queryKey[index] === part,
  );
}

export function useMarkAnnouncementRead(memberId?: string) {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const effectiveMemberId = memberId ?? session?.user.id;
  return useMutation(
    markAnnouncementReadMutationOptions(queryClient, effectiveMemberId),
  );
}
