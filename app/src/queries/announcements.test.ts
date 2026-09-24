import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { supabase } from '../lib/supabase';
import {
  fetchAnnouncementsFeed,
  markAnnouncementRead,
  announcementsFeedQueryOptions,
  createAnnouncement,
  fetchAnnouncementReaders,
  fetchUnreadAnnouncementsCount,
  markAnnouncementReadMutationOptions,
  unreadAnnouncementsCountQueryOptions,
} from './announcements';
import { keys } from './keys';

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

describe('announcements query layer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchAnnouncementsFeed', () => {
    it('queries announcements table with embedded reads ordered by pinned and date', async () => {
      const mockOrderDate = vi.fn().mockResolvedValue({
        data: [
          {
            id: 1,
            title: 'Test',
            body: 'Content',
            dept_id: null,
            author: 'BC',
            priority: 'normal',
            category: null,
            pinned: false,
            form_label: null,
            form_url: null,
            published_at: '2026-09-19T10:00:00Z',
            created_by: null,
            announcement_reads: [],
          },
        ],
        error: null,
      });

      const mockOrderPinned = vi.fn().mockReturnValue({
        order: mockOrderDate,
      });

      const mockSelect = vi.fn().mockReturnValue({
        order: mockOrderPinned,
      });

      (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        select: mockSelect,
      });

      const rows = await fetchAnnouncementsFeed();

      expect(supabase.from).toHaveBeenCalledWith('announcements');
      expect(mockSelect).toHaveBeenCalledWith(
        expect.stringContaining('announcement_reads'),
      );
      expect(mockSelect.mock.calls[0]?.[0]).toContain('group_id');
      expect(mockSelect.mock.calls[0]?.[0]).toContain('audience');
      expect(mockOrderPinned).toHaveBeenCalledWith('pinned', {
        ascending: false,
      });
      expect(mockOrderDate).toHaveBeenCalledWith('published_at', {
        ascending: false,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(1);
    });

    it('throws error when database query fails', async () => {
      const mockOrderDate = vi.fn().mockResolvedValue({
        data: null,
        error: { code: '42501', message: 'permission denied' },
      });

      const mockOrderPinned = vi.fn().mockReturnValue({
        order: mockOrderDate,
      });

      const mockSelect = vi.fn().mockReturnValue({
        order: mockOrderPinned,
      });

      (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        select: mockSelect,
      });

      await expect(fetchAnnouncementsFeed()).rejects.toEqual({
        code: '42501',
        message: 'permission denied',
      });
    });
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
      created_by: 'member-1',
    };
    await createAnnouncement(payload);
    expect(insert).toHaveBeenCalledWith(payload);
    expect(select).not.toHaveBeenCalled();
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

  describe('announcementsFeedQueryOptions', () => {
    it('returns options with memberId in query key', () => {
      const options = announcementsFeedQueryOptions('user-123');

      expect(options.queryKey).toEqual(keys.announcements.feed('user-123'));
      expect(typeof options.queryFn).toBe('function');
    });
  });
  describe('unread announcements count', () => {
    it('asks the server for the count the badge shows', async () => {
      const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;
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

      await options.onSuccess();

      expect(
        queryClient.getQueryState(keys.announcements.unread('m1'))
          ?.isInvalidated,
      ).toBe(true);
    });
  });

  describe('fetchAnnouncementReaders', () => {
    it('answers null on PT404, so the readers line stays hidden', async () => {
      (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: null,
        error: { code: 'PT404', message: 'announcement_not_found' },
      });

      await expect(fetchAnnouncementReaders(7)).resolves.toBeNull();
      expect(supabase.rpc).toHaveBeenCalledWith('announcement_readers', {
        p_announcement_id: 7,
      });
    });

    it('throws any other failure', async () => {
      (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: null,
        error: { code: '08006', message: 'connection failure' },
      });

      await expect(fetchAnnouncementReaders(7)).rejects.toMatchObject({
        code: '08006',
      });
    });

    it('names every recipient from the directory, unread ones with a null time', async () => {
      (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: [
          { member_id: 'a', read_at: '2026-09-20T10:00:00Z' },
          { member_id: 'b', read_at: null },
        ],
        error: null,
      });
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
