import { describe, expect, it } from 'vitest';
import type { Group } from '../../queries/reference';
import {
  countUnreadAnnouncements,
  formatAnnouncementDate,
  getUnreadCriticalAnnouncement,
  priorityMeta,
  sortAnnouncements,
  toAnnouncementPresentation,
  type RawAnnouncementRow,
} from './announcements-presentation';

const groupsById = new Map<number, Group>([
  [
    1,
    {
      id: 1,
      name: 'Educațional',
      short: 'EDU',
      color: '#284C93',
      category: 'department',
      path: [1],
      parent_id: null,
      min_level: 1,
      status: 'active',
      is_organization: false,
    },
  ],
  [
    2,
    {
      id: 2,
      name: 'Imagine & PR',
      short: 'PR',
      color: '#7500A0',
      category: 'department',
      path: [2],
      parent_id: null,
      min_level: 1,
      status: 'active',
      is_organization: false,
    },
  ],
]);

function rawRow(
  overrides: Partial<RawAnnouncementRow> = {},
): RawAnnouncementRow {
  return {
    id: 1,
    title: 'Ședință extraordinară BC',
    body: 'Vineri la ora 18:00 în Aula Magna.',
    group_id: 1,
    audience: 'org',
    author: 'BC',
    priority: 'critical',
    category: 'organizatoric',
    pinned: true,
    form_label: null,
    form_url: null,
    published_at: '2026-09-18T15:00:00.000Z',
    created_by: 'd0000000-0000-0000-0000-000000000007',
    announcement_reads: [],
    ...overrides,
  };
}

describe('announcements-presentation', () => {
  describe('toAnnouncementPresentation', () => {
    it('keeps Group Origin distinct from an organization-wide Audience', () => {
      const item = toAnnouncementPresentation(rawRow(), groupsById);
      expect(item.groupId).toBe(1);
      expect(item.group).toEqual({
        id: 1,
        name: 'Educațional',
        short: 'EDU',
        color: '#284C93',
      });
      expect(item.audience).toBe('org');
      expect(item.audienceLabel).toBe('Toată organizația');
      expect(item.isRead).toBe(false);
    });

    it('uses group_id for the announcement origin', () => {
      const item = toAnnouncementPresentation(
        rawRow({ group_id: 2, audience: 'local' }),
        groupsById,
      );
      expect(item.group.name).toBe('Imagine & PR');
      expect(item.audienceLabel).toBe('Doar grupul');
    });

    it('uses a neutral Group fallback when its reference row is unavailable', () => {
      const item = toAnnouncementPresentation(rawRow({ group_id: 99 }));
      expect(item.group).toEqual({ id: 99, name: 'Grup', short: 'GRUP' });
    });

    it('detects read status from announcement_reads relation', () => {
      const unreadItem = toAnnouncementPresentation(
        rawRow({ announcement_reads: [] }),
      );
      expect(unreadItem.isRead).toBe(false);

      const readItem = toAnnouncementPresentation(
        rawRow({
          announcement_reads: [{ read_at: '2026-09-18T16:00:00.000Z' }],
        }),
      );
      expect(readItem.isRead).toBe(true);
    });

    it('handles form links correctly', () => {
      const item = toAnnouncementPresentation(
        rawRow({
          form_label: 'Completează formularul',
          form_url: 'https://forms.gle/exemplu',
        }),
      );

      expect(item.formLabel).toBe('Completează formularul');
      expect(item.formUrl).toBe('https://forms.gle/exemplu');
    });
  });

  describe('priorityMeta', () => {
    it('returns critical priority metadata with danger variant', () => {
      const meta = priorityMeta('critical');
      expect(meta.label).toBe('Critic');
      expect(meta.variant).toBe('destructive');
    });

    it('returns important priority metadata with secondary variant', () => {
      const meta = priorityMeta('important');
      expect(meta.label).toBe('Important');
      expect(meta.variant).toBe('secondary');
    });

    it('returns normal priority metadata with outline variant', () => {
      const meta = priorityMeta('normal');
      expect(meta.label).toBe('Normal');
      expect(meta.variant).toBe('outline');
    });
  });

  describe('sortAnnouncements', () => {
    it('sorts pinned announcements first, then descending by date', () => {
      const olderPinned = toAnnouncementPresentation(
        rawRow({
          id: 1,
          pinned: true,
          published_at: '2026-09-10T10:00:00.000Z',
        }),
      );
      const newerUnpinned = toAnnouncementPresentation(
        rawRow({
          id: 2,
          pinned: false,
          published_at: '2026-09-18T10:00:00.000Z',
        }),
      );
      const newerPinned = toAnnouncementPresentation(
        rawRow({
          id: 3,
          pinned: true,
          published_at: '2026-09-15T10:00:00.000Z',
        }),
      );
      const olderUnpinned = toAnnouncementPresentation(
        rawRow({
          id: 4,
          pinned: false,
          published_at: '2026-09-05T10:00:00.000Z',
        }),
      );

      const sorted = sortAnnouncements([
        olderPinned,
        newerUnpinned,
        newerPinned,
        olderUnpinned,
      ]);

      expect(sorted.map((item) => item.id)).toEqual([3, 1, 2, 4]);
    });
  });

  describe('countUnreadAnnouncements', () => {
    it('counts only items that have isRead = false', () => {
      const items = [
        toAnnouncementPresentation(rawRow({ id: 1, announcement_reads: [] })),
        toAnnouncementPresentation(
          rawRow({
            id: 2,
            announcement_reads: [{ read_at: '2026-09-18T10:00:00Z' }],
          }),
        ),
        toAnnouncementPresentation(rawRow({ id: 3, announcement_reads: [] })),
      ];

      expect(countUnreadAnnouncements(items)).toBe(2);
    });
  });

  describe('getUnreadCriticalAnnouncement', () => {
    it('returns first unread critical announcement', () => {
      const normalUnread = toAnnouncementPresentation(
        rawRow({ id: 1, priority: 'normal', announcement_reads: [] }),
      );
      const criticalRead = toAnnouncementPresentation(
        rawRow({
          id: 2,
          priority: 'critical',
          announcement_reads: [{ read_at: '2026-09-18T10:00:00Z' }],
        }),
      );
      const criticalUnread = toAnnouncementPresentation(
        rawRow({ id: 3, priority: 'critical', announcement_reads: [] }),
      );

      const result = getUnreadCriticalAnnouncement([
        normalUnread,
        criticalRead,
        criticalUnread,
      ]);

      expect(result?.id).toBe(3);
    });

    it('returns null when no unread critical announcements exist', () => {
      const items = [
        toAnnouncementPresentation(
          rawRow({
            id: 1,
            priority: 'critical',
            announcement_reads: [{ read_at: '2026-09-18T10:00:00Z' }],
          }),
        ),
        toAnnouncementPresentation(
          rawRow({ id: 2, priority: 'important', announcement_reads: [] }),
        ),
      ];

      expect(getUnreadCriticalAnnouncement(items)).toBeNull();
    });
  });

  describe('formatAnnouncementDate', () => {
    it('formats date in Romanian using Bucharest timezone', () => {
      const formatted = formatAnnouncementDate('2026-09-18T15:30:00.000Z');
      expect(formatted).toContain('septembrie');
      expect(formatted).toContain('2026');
    });
  });
});
