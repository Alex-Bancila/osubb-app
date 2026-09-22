import { describe, expect, it, vi, beforeEach } from 'vitest';
import { supabase } from '../lib/supabase';
import {
  fetchAnnouncementsFeed,
  markAnnouncementRead,
  announcementsFeedQueryOptions,
} from './announcements';
import { keys } from './keys';

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
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
});
