import { describe, expect, it } from 'vitest';
import type { Group } from '../../queries/reference';
import {
  countUnreadAnnouncements,
  formatAnnouncementDate,
  getUnreadCriticalAnnouncement,
  mayAskForReaders,
  priorityMeta,
  readersSummary,
  sortAnnouncements,
  toAnnouncementPresentation,
  unreadAnnouncementsLabel,
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
      legacy_dept_id: 'edu',
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
      legacy_dept_id: 'pr',
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
    dept_id: null,
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

    it('uses group_id even when the historical dept_id is null', () => {
      const item = toAnnouncementPresentation(
        rawRow({ group_id: 2, dept_id: null, audience: 'local' }),
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
  describe('R15 ordering', () => {
    const READ = [{ read_at: '2026-09-20T10:00:00Z' }];
    it('puts pinned first whatever their read state, then unread, then read, newest first in each band', () => {
      const rows = [
        rawRow({
          id: 1,
          pinned: false,
          announcement_reads: READ,
          published_at: '2026-09-05T10:00:00Z',
        }), // read old
        rawRow({
          id: 2,
          pinned: false,
          announcement_reads: [],
          published_at: '2026-09-06T10:00:00Z',
        }), // unread old
        rawRow({
          id: 3,
          pinned: true,
          announcement_reads: READ,
          published_at: '2026-09-01T10:00:00Z',
        }), // pinned read
        rawRow({
          id: 4,
          pinned: false,
          announcement_reads: READ,
          published_at: '2026-09-19T10:00:00Z',
        }), // read new
        rawRow({
          id: 5,
          pinned: false,
          announcement_reads: [],
          published_at: '2026-09-18T10:00:00Z',
        }), // unread new
        rawRow({
          id: 6,
          pinned: true,
          announcement_reads: [],
          published_at: '2026-08-30T10:00:00Z',
        }), // pinned unread
      ];
      const sorted = sortAnnouncements(
        rows.map((row) => toAnnouncementPresentation(row)),
      );
      expect(sorted.map((item) => item.id)).toEqual([3, 6, 5, 2, 4, 1]);
    });

    it('keeps a read, pinned Announcement above an unread, unpinned one', () => {
      const sorted = sortAnnouncements([
        toAnnouncementPresentation(
          rawRow({
            id: 1,
            pinned: false,
            announcement_reads: [],
            published_at: '2026-09-20T10:00:00Z',
          }),
        ),
        toAnnouncementPresentation(
          rawRow({
            id: 2,
            pinned: true,
            announcement_reads: READ,
            published_at: '2026-09-01T10:00:00Z',
          }),
        ),
      ]);
      expect(sorted.map((item) => item.id)).toEqual([2, 1]);
    });
  });

  describe('author', () => {
    it('names the author through created_by, with the byline until the directory answers', () => {
      const pending = toAnnouncementPresentation(rawRow({ author: 'Ana Pop' }));
      expect(pending.authorMember).toEqual({
        memberId: 'd0000000-0000-0000-0000-000000000007',
        fullName: 'Ana Pop',
      });
      const resolved = toAnnouncementPresentation(
        rawRow(),
        groupsById,
        new Map([
          [
            'd0000000-0000-0000-0000-000000000007',
            {
              memberId: 'd0000000-0000-0000-0000-000000000007',
              nickname: 'Ani',
              fullName: 'Ana Pop',
              avatarColor: '#284C93',
            },
          ],
        ]),
      );
      expect(resolved.authorMember?.nickname).toBe('Ani');
    });

    it('keeps the text byline on a legacy row without created_by', () => {
      const item = toAnnouncementPresentation(rawRow({ created_by: null }));
      expect(item.authorMember).toBeNull();
      expect(item.author).toBe('BC');
    });
  });

  describe('unreadAnnouncementsLabel', () => {
    it('says the count in words, singular and plural', () => {
      expect(unreadAnnouncementsLabel(1)).toBe('1 anunț necitit');
      expect(unreadAnnouncementsLabel(4)).toBe('4 anunțuri necitite');
    });
  });

  describe('mayAskForReaders', () => {
    const author = 'd0000000-0000-0000-0000-000000000007';
    const other = 'd0000000-0000-0000-0000-000000000008';
    const local = toAnnouncementPresentation(
      rawRow({ audience: 'local', group_id: 2 }),
    );
    const org = toAnnouncementPresentation(
      rawRow({ audience: 'org', group_id: 2 }),
    );
    const managerOf2 = [{ id: 2, group_role: 'manager' }];

    it('lets the author and BC/Moderator ask, for any Audience', () => {
      expect(
        mayAskForReaders(org, {
          memberId: author,
          bcOrModerator: false,
          groups: [],
        }),
      ).toBe(true);
      expect(
        mayAskForReaders(org, {
          memberId: other,
          bcOrModerator: true,
          groups: [],
        }),
      ).toBe(true);
    });

    it("lets the Origin's Managers and Responsibles ask only for a local Audience", () => {
      expect(
        mayAskForReaders(local, {
          memberId: other,
          bcOrModerator: false,
          groups: managerOf2,
        }),
      ).toBe(true);
      expect(
        mayAskForReaders(local, {
          memberId: other,
          bcOrModerator: false,
          groups: [{ id: 2, group_role: 'responsible' }],
        }),
      ).toBe(true);
      expect(
        mayAskForReaders(org, {
          memberId: other,
          bcOrModerator: false,
          groups: managerOf2,
        }),
      ).toBe(false);
    });

    it('does not ask for an ordinary member of the Origin', () => {
      expect(
        mayAskForReaders(local, {
          memberId: other,
          bcOrModerator: false,
          groups: [{ id: 2, group_role: 'member' }],
        }),
      ).toBe(false);
      expect(
        mayAskForReaders(local, {
          memberId: undefined,
          bcOrModerator: true,
          groups: [],
        }),
      ).toBe(false);
    });
  });

  describe('readersSummary', () => {
    it('splits read from unread and counts the whole Audience', () => {
      const summary = readersSummary([
        {
          member: { memberId: 'a', fullName: 'A' },
          readAt: '2026-09-20T10:00:00Z',
        },
        { member: { memberId: 'b', fullName: 'B' }, readAt: null },
        { member: { memberId: 'c', fullName: 'C' }, readAt: null },
      ]);
      expect(summary.label).toBe('Citit de 1 din 3');
      expect(summary.read.map((reader) => reader.member.memberId)).toEqual([
        'a',
      ]);
      expect(summary.unread.map((reader) => reader.member.memberId)).toEqual([
        'b',
        'c',
      ]);
    });
  });
});
