import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';

import { useAuth } from '../lib/auth';
import type { Database } from '../lib/database.types';
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
 * "Marchează tot ca citit" — one self-scoped statement, not a loop over rows.
 * `where member_id = … and not read` is exactly what the policy admits, so the
 * database decides the scope and the browser never enumerates what to write.
 */
export async function markAllNotificationsRead(
  memberId: string,
): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('member_id', memberId)
    .eq('read', false);

  if (error) throw error;
}

export function markAllNotificationsReadMutationOptions(
  queryClient: QueryClient,
  memberId?: string,
) {
  return {
    mutationFn: () => {
      if (!memberId) throw new Error('Not authenticated');
      return markAllNotificationsRead(memberId);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.notifications.all });
    },
  } as const;
}

export function useMarkAllNotificationsRead(memberId?: string) {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const effectiveMemberId = memberId ?? session?.user.id;
  return useMutation(
    markAllNotificationsReadMutationOptions(queryClient, effectiveMemberId),
  );
}
