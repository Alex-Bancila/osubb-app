import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';

import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { useAuth } from '../lib/auth';
import type { Database } from '../lib/database.types';
import {
  openedNotificationId,
  withoutNotificationParam,
} from '../lib/notification-param';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

export type NotificationRow =
  Database['public']['Tables']['notifications']['Row'];

/* Everything the Notification centre renders. `member_id` is deliberately not
   selected: every row this session can read is already its own (#65's
   `notifications_read_self`), so echoing the recipient back would only invite
   a screen to re-implement that rule in TypeScript. */
const NOTIFICATION_FIELDS =
  'id, kind, icon, title, body, critical, read, link, created_at';

/** One screenful. Small enough that the first page arrives instantly. */
export const NOTIFICATIONS_PAGE_SIZE = 20;

export type NotificationsPage = {
  rows: NotificationRow[];
  /** The page index to ask for next, or `null` when the history ends here. */
  nextPage: number | null;
};

/**
 * "Mine, newest first", one page at a time.
 *
 * The member filter is not a second copy of RLS — it is what lets Postgres use
 * `notifications_member_created_idx (member_id, created_at desc)` instead of
 * filtering the whole table after the fact. `id` breaks ties so two rows
 * written in the same transaction keep a stable order across pages; without it
 * a row can appear twice, or never, as the reader pages down.
 */
export async function fetchNotificationsPage(
  memberId: string,
  page: number,
  pageSize: number = NOTIFICATIONS_PAGE_SIZE,
): Promise<NotificationsPage> {
  const from = page * pageSize;
  const { data, error } = await supabase
    .from('notifications')
    .select(NOTIFICATION_FIELDS)
    .eq('member_id', memberId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, from + pageSize - 1);

  if (error) throw error;

  const rows = (data as unknown as NotificationRow[]) ?? [];
  return { rows, nextPage: rows.length < pageSize ? null : page + 1 };
}

export function notificationsQueryOptions(
  memberId: string,
  pageSize: number = NOTIFICATIONS_PAGE_SIZE,
) {
  return {
    queryKey: keys.notifications.list(memberId),
    queryFn: ({ pageParam }: { pageParam: number }) =>
      fetchNotificationsPage(memberId, pageParam, pageSize),
    initialPageParam: 0,
    getNextPageParam: (lastPage: NotificationsPage) => lastPage.nextPage,
  } as const;
}

export function useNotifications(memberId?: string) {
  const { session } = useAuth();
  const effectiveMemberId = memberId ?? session?.user.id;

  return useInfiniteQuery({
    ...notificationsQueryOptions(effectiveMemberId ?? ''),
    enabled: Boolean(effectiveMemberId),
  });
}

/**
 * The badge count, asked as a count and never as a list: `head: true` sends no
 * rows back at all, and the `(member_id) where not read` partial index answers
 * it without touching read history.
 */
export async function fetchUnreadNotificationCount(
  memberId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('member_id', memberId)
    .eq('read', false);

  if (error) throw error;
  return count ?? 0;
}

export function unreadNotificationCountQueryOptions(memberId: string) {
  return {
    queryKey: keys.notifications.unread(memberId),
    queryFn: () => fetchUnreadNotificationCount(memberId),
  } as const;
}

export function useUnreadNotificationCount(memberId?: string) {
  const { session } = useAuth();
  const effectiveMemberId = memberId ?? session?.user.id;

  return useQuery({
    ...unreadNotificationCountQueryOptions(effectiveMemberId ?? ''),
    enabled: Boolean(effectiveMemberId),
  });
}

export type MarkNotificationReadInput = {
  notificationId: number;
  memberId: string;
};

/**
 * Opening a Notification marks it read.
 *
 * No server command exists for this on purpose: #65 grants `update (read)` and
 * nothing else, so the narrowest possible write is already the only legal one.
 */
export async function markNotificationRead(
  input: MarkNotificationReadInput,
): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('id', input.notificationId)
    .eq('member_id', input.memberId);

  if (error) throw error;
}

export function markNotificationReadMutationOptions(
  queryClient: QueryClient,
  memberId?: string,
) {
  return {
    mutationFn: (notificationId: number) => {
      if (!memberId) throw new Error('Not authenticated');
      return markNotificationRead({ notificationId, memberId });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.notifications.all });
    },
  } as const;
}

export function useMarkNotificationRead(memberId?: string) {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const effectiveMemberId = memberId ?? session?.user.id;
  return useMutation(
    markNotificationReadMutationOptions(queryClient, effectiveMemberId),
  );
}

/**
 * #1012 (R37): the subjects of the member's unread Notifications —
 * `task:12`, `event:3`, `promotion_candidate:<uuid>`… A screen that opens a
 * thing reads its Notifications only when one of them is about it, so
 * opening a Task with nothing unread about it sends no write at all.
 */
export async function fetchUnreadNotificationSubjects(
  memberId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('subject')
    .eq('member_id', memberId)
    .eq('read', false)
    .not('subject', 'is', null);

  if (error) throw error;
  return [
    ...new Set(
      ((data ?? []) as { subject: string | null }[]).flatMap((row) =>
        row.subject ? [row.subject] : [],
      ),
    ),
  ];
}

export function unreadNotificationSubjectsQueryOptions(memberId: string) {
  return {
    queryKey: keys.notifications.subjects(memberId),
    queryFn: () => fetchUnreadNotificationSubjects(memberId),
  } as const;
}

/** No subject: a screen with nothing open yet. Stable, so effects stay put. */
export const NO_SUBJECTS: readonly string[] = [];

/** The subject that stands for the whole Promotion Candidates list. */
export const PROMOTION_CANDIDATES_SUBJECT = 'promotion_candidate';

function isUnread(subject: string, unread: ReadonlySet<string>): boolean {
  if (subject !== PROMOTION_CANDIDATES_SUBJECT) return unread.has(subject);
  for (const candidate of unread)
    if (candidate.startsWith(`${PROMOTION_CANDIDATES_SUBJECT}:`)) return true;
  return false;
}

/**
 * Marks the caller's own unread Notifications about one thing read
 * (`public.mark_notifications_read_for`, #1012): one request, own rows only.
 */
export async function markNotificationsReadFor(
  subject: string,
): Promise<number> {
  const { data, error } = await supabase.rpc('mark_notifications_read_for', {
    p_subject: subject,
  });
  if (error) throw error;
  return data ?? 0;
}

/**
 * Opening a thing reads its Notifications (#1012, R37). Pass the subjects a
 * screen shows — the Task in the details sheet, the linked Event, the
 * Requests and Applications on a list, `PROMOTION_CANDIDATES_SUBJECT` for the
 * candidates list. For each one the member has an unread Notification about,
 * one request marks them read, once; the badge and the list refresh after.
 * A failed write leaves them unread, which is the honest outcome.
 */
export function useReadNotificationsAbout(subjects: readonly string[]) {
  const { session } = useAuth();
  const memberId = session?.user.id;
  const queryClient = useQueryClient();
  const subjectsKey = subjects.join('\n');
  const unread = useQuery({
    ...unreadNotificationSubjectsQueryOptions(memberId ?? ''),
    enabled: Boolean(memberId) && subjectsKey !== '',
  });
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    if (!memberId || !unread.data || subjectsKey === '') return;
    const pending = new Set(unread.data);
    for (const subject of new Set(subjectsKey.split('\n'))) {
      if (!isUnread(subject, pending) || inFlight.current.has(subject))
        continue;
      inFlight.current.add(subject);
      void markNotificationsReadFor(subject)
        .then(() =>
          queryClient.invalidateQueries({ queryKey: keys.notifications.all }),
        )
        .catch(() => undefined)
        .finally(() => inFlight.current.delete(subject));
    }
  }, [memberId, unread.data, subjectsKey, queryClient]);
}

/**
 * "Marchează toate ca citite" (#1012, R37 — amends R16): one request,
 * `public.mark_all_notifications_read()`, which the server allows only for a
 * live level ≥ 5 (BCE, BC, the Moderator) and confines to the caller's own
 * rows. Returns how many were marked.
 */
export async function markAllNotificationsRead(): Promise<number> {
  const { data, error } = await supabase.rpc('mark_all_notifications_read');
  if (error) throw error;
  return data ?? 0;
}

export function markAllNotificationsReadMutationOptions(
  queryClient: QueryClient,
) {
  return {
    mutationFn: markAllNotificationsRead,
    // The list, the bell badge and the unread subjects all read "mine".
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.notifications.all });
    },
  } as const;
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation(markAllNotificationsReadMutationOptions(queryClient));
}

/**
 * A push tap or an Email Digest link opened the app with `?notificare=<id>`
 * (#1012, R37): mark that one Notification read — the same single-row update
 * as opening it in Notificări — and take the parameter out of the address,
 * replacing the history entry so Back does not bring it back.
 */
export function useReadOpenedNotification() {
  const location = useLocation();
  const navigate = useNavigate();
  const { mutate } = useMarkNotificationRead();
  const handled = useRef(new Set<number>());

  useEffect(() => {
    const id = openedNotificationId(location.search);
    if (id === null) return;
    void navigate(
      {
        pathname: location.pathname,
        search: withoutNotificationParam(location.search),
        hash: location.hash,
      },
      { replace: true, state: location.state as unknown },
    );
    if (handled.current.has(id)) return;
    handled.current.add(id);
    mutate(id);
  }, [location, navigate, mutate]);
}
