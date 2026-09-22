import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetSupabaseMock, supabaseMock } from '../test/supabase-mock';

vi.mock('../lib/supabase', async () => {
  const { supabaseClientMock } = await vi.importActual<
    typeof import('../test/supabase-mock')
  >('../test/supabase-mock');
  return { supabase: supabaseClientMock };
});

import {
  fetchNotificationsPage,
  fetchUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
  notificationsQueryOptions,
  unreadNotificationCountQueryOptions,
  type NotificationRow,
} from './notifications';
import { keys } from './keys';

const MEMBER = '11111111-1111-4111-8111-111111111111';

function notificationRow(
  overrides: Partial<NotificationRow> = {},
): NotificationRow {
  return {
    id: 1,
    member_id: MEMBER,
    kind: 'task',
    icon: null,
    title: 'Task nou: Afiș pentru AGO',
    body: 'Ai fost desemnat executor.',
    critical: false,
    read: false,
    link: '/tracker/12',
    created_at: '2026-09-20T09:00:00.000Z',
    dedupe_key: null,
    task_id: 12,
    ...overrides,
  };
}

describe('notifications query layer', () => {
  beforeEach(() => {
    resetSupabaseMock();
  });

  describe('fetchNotificationsPage', () => {
    it('asks for one page of the caller’s own rows, newest first', async () => {
      supabaseMock.range.mockResolvedValue({
        data: [notificationRow()],
        error: null,
      });

      const page = await fetchNotificationsPage(MEMBER, 0, 20);

      expect(supabaseMock.from).toHaveBeenCalledWith('notifications');
      expect(supabaseMock.select).toHaveBeenCalledWith(
        expect.stringContaining('created_at'),
      );
      expect(supabaseMock.eq).toHaveBeenCalledWith('member_id', MEMBER);
      expect(supabaseMock.order).toHaveBeenNthCalledWith(1, 'created_at', {
        ascending: false,
      });
      expect(supabaseMock.order).toHaveBeenNthCalledWith(2, 'id', {
        ascending: false,
      });
      expect(supabaseMock.range).toHaveBeenCalledWith(0, 19);
      expect(page.rows).toHaveLength(1);
    });

    it('stops paging when a page comes back short', async () => {
      supabaseMock.range.mockResolvedValue({
        data: [notificationRow()],
        error: null,
      });

      await expect(
        fetchNotificationsPage(MEMBER, 0, 20),
      ).resolves.toMatchObject({ nextPage: null });
    });

    it('offers the next page when this one is full', async () => {
      supabaseMock.range.mockResolvedValue({
        data: [notificationRow({ id: 2 }), notificationRow({ id: 1 })],
        error: null,
      });

      const page = await fetchNotificationsPage(MEMBER, 1, 2);

      expect(supabaseMock.range).toHaveBeenCalledWith(2, 3);
      expect(page.nextPage).toBe(2);
    });

    it('throws when the read is refused', async () => {
      supabaseMock.range.mockResolvedValue({
        data: null,
        error: { code: '42501', message: 'permission denied' },
      });

      await expect(fetchNotificationsPage(MEMBER, 0, 20)).rejects.toEqual({
        code: '42501',
        message: 'permission denied',
      });
    });
  });

  describe('fetchUnreadNotificationCount', () => {
    it('counts unread rows without fetching any', async () => {
      supabaseMock.eq
        .mockReturnValueOnce(supabaseMock)
        .mockResolvedValueOnce({ count: 3, error: null });

      await expect(fetchUnreadNotificationCount(MEMBER)).resolves.toBe(3);

      expect(supabaseMock.select).toHaveBeenCalledWith('id', {
        count: 'exact',
        head: true,
      });
      expect(supabaseMock.eq).toHaveBeenNthCalledWith(1, 'member_id', MEMBER);
      expect(supabaseMock.eq).toHaveBeenNthCalledWith(2, 'read', false);
    });

    it('reads a missing count as zero', async () => {
      supabaseMock.eq
        .mockReturnValueOnce(supabaseMock)
        .mockResolvedValueOnce({ count: null, error: null });

      await expect(fetchUnreadNotificationCount(MEMBER)).resolves.toBe(0);
    });

    it('throws when the count is refused', async () => {
      supabaseMock.eq.mockReturnValueOnce(supabaseMock).mockResolvedValueOnce({
        count: null,
        error: { code: '42501', message: 'permission denied' },
      });

      await expect(fetchUnreadNotificationCount(MEMBER)).rejects.toEqual({
        code: '42501',
        message: 'permission denied',
      });
    });
  });

  describe('markNotificationRead', () => {
    it('writes only the read marker, on one of the caller’s own rows', async () => {
      supabaseMock.eq
        .mockReturnValueOnce(supabaseMock)
        .mockResolvedValueOnce({ error: null });

      await markNotificationRead({ notificationId: 12, memberId: MEMBER });

      expect(supabaseMock.from).toHaveBeenCalledWith('notifications');
      expect(supabaseMock.update).toHaveBeenCalledWith({ read: true });
      expect(supabaseMock.eq).toHaveBeenNthCalledWith(1, 'id', 12);
      expect(supabaseMock.eq).toHaveBeenNthCalledWith(2, 'member_id', MEMBER);
    });

    it('throws when the update is refused', async () => {
      supabaseMock.eq.mockReturnValueOnce(supabaseMock).mockResolvedValueOnce({
        error: { code: '42501', message: 'permission denied' },
      });

      await expect(
        markNotificationRead({ notificationId: 12, memberId: MEMBER }),
      ).rejects.toEqual({ code: '42501', message: 'permission denied' });
    });
  });

  describe('markAllNotificationsRead', () => {
    it('is a single self-scoped update over the unread rows', async () => {
      supabaseMock.eq
        .mockReturnValueOnce(supabaseMock)
        .mockResolvedValueOnce({ error: null });

      await markAllNotificationsRead(MEMBER);

      expect(supabaseMock.update).toHaveBeenCalledTimes(1);
      expect(supabaseMock.update).toHaveBeenCalledWith({ read: true });
      expect(supabaseMock.eq).toHaveBeenNthCalledWith(1, 'member_id', MEMBER);
      expect(supabaseMock.eq).toHaveBeenNthCalledWith(2, 'read', false);
    });

    it('throws when the update is refused', async () => {
      supabaseMock.eq.mockReturnValueOnce(supabaseMock).mockResolvedValueOnce({
        error: { code: '42501', message: 'permission denied' },
      });

      await expect(markAllNotificationsRead(MEMBER)).rejects.toEqual({
        code: '42501',
        message: 'permission denied',
      });
    });
  });

  describe('query options', () => {
    it('keys the list and the badge by member, under one family', () => {
      const list = notificationsQueryOptions(MEMBER);
      const unread = unreadNotificationCountQueryOptions(MEMBER);

      expect(list.queryKey).toEqual(keys.notifications.list(MEMBER));
      expect(unread.queryKey).toEqual(keys.notifications.unread(MEMBER));
      expect(list.queryKey[0]).toBe(keys.notifications.all[0]);
      expect(unread.queryKey[0]).toBe(keys.notifications.all[0]);
      expect(list.initialPageParam).toBe(0);
      expect(list.getNextPageParam({ rows: [], nextPage: 2 })).toBe(2);
    });
  });
});
