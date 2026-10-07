import { describe, expect, it } from 'vitest';
import type { Group } from '../../queries/reference';
import {
  describeTermen,
  minLevelLabel,
  countUnreadAnnouncements,
  formatAnnouncementDate,
  getUnreadCriticalAnnouncement,
  mayAskForReaders,
  mayManageAnnouncement,
  originLabel,
  priorityMeta,
  readersSummary,
  showsPriority,
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
    },
  ],
  [
    5,
    {
      id: 5,
      name: 'Organizația',
      short: 'ORG',
      color: '#D0021B',
      category: 'organization',
      path: [5],
      parent_id: null,
      min_level: 1,
      status: 'active',
      is_organization: true,
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
    priority: 'critical',
    pinned: true,
    form_label: null,
    form_url: null,
    links: [],
    kind: 'announcement',
    code: null,
    published_at: '2026-09-18T15:00:00.000Z',
    deadline: null,
    min_level: 0,
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
        isOrganization: false,
      });
      expect(item.audience).toBe('org');
      // B34: the Origin chip says whose it is; an organization Audience adds nothing.
      expect(item.audienceLabel).toBeNull();
      expect(item.isRead).toBe(false);
    });

    it('uses group_id for the announcement origin', () => {
      const item = toAnnouncementPresentation(
        rawRow({ group_id: 2, audience: 'local' }),
        groupsById,
      );
      expect(item.group.name).toBe('Imagine & PR');
      // B34: a local Audience names the Group ("Doar Educațional").
      expect(item.audienceLabel).toBe('Doar Imagine & PR');
    });

    it('names the Organization Group "OSUBB" and never shows its local Audience', () => {
      const item = toAnnouncementPresentation(
        rawRow({ group_id: 5, audience: 'local' }),
        groupsById,
      );
      expect(originLabel(item.group)).toBe('OSUBB');
      expect(item.audienceLabel).toBeNull();
      expect(
        originLabel(toAnnouncementPresentation(rawRow(), groupsById).group),
      ).toBe('Educațional');
    });

    it('keeps "Doar grupul" for a local Announcement whose Origin is unresolved', () => {
      const item = toAnnouncementPresentation(
        rawRow({ group_id: 99, audience: 'local' }),
        groupsById,
      );
      expect(item.audienceLabel).toBe('Doar grupul');
      expect(originLabel(item.group)).toBe('Grup');
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
          links: [
            {
              label: 'Completează formularul',
              url: 'https://forms.gle/exemplu',
            },
            { label: '', url: 'https://ignored.example' },
            { label: 'Program', url: 'https://osubb.ro/p' },
          ],
        }),
      );

      expect(item.links).toEqual([
        { label: 'Completează formularul', url: 'https://forms.gle/exemplu' },
        { label: 'Program', url: 'https://osubb.ro/p' },
      ]);
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

    it('marks only Important and Critic on the card (B34)', () => {
      expect(showsPriority('critical')).toBe(true);
      expect(showsPriority('important')).toBe(true);
      expect(showsPriority('normal')).toBe(false);
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
    it('names the author through created_by, with a placeholder until the directory answers', () => {
      const pending = toAnnouncementPresentation(rawRow());
      expect(pending.authorMember).toEqual({
        memberId: 'd0000000-0000-0000-0000-000000000007',
        fullName: 'Membru OSUBB',
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

    it('names no author on a legacy row without created_by (#936: no text byline)', () => {
      const item = toAnnouncementPresentation(rawRow({ created_by: null }));
      expect(item.authorMember).toBeNull();
      expect(item).not.toHaveProperty('author');
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

  describe('mayManageAnnouncement (#857, #930: announcements_update and _delete)', () => {
    const origin = { groupId: 7, group: { id: 7, name: 'Educațional' } };
    const orgWide = {
      groupId: 1,
      group: { id: 1, name: 'OSUBB', isOrganization: true },
    };
    const none = { bcOrModerator: false, managesAnyGroup: false, groups: [] };

    it('lets a Responsible inherited from a Group above manage it', () => {
      // my_groups() lists the Origin with the Role held on its parent.
      expect(
        mayManageAnnouncement(origin, {
          ...none,
          managesAnyGroup: true,
          groups: [
            { id: 3, group_role: 'responsible', status: 'active' },
            { id: 7, group_role: 'responsible', status: 'active' },
          ],
        }),
      ).toBe(true);
    });

    it('grants the author nothing by itself, nor a plain Member', () => {
      // The author of a local Announcement who no longer holds a Role there.
      expect(
        mayManageAnnouncement(origin, {
          ...none,
          groups: [{ id: 7, group_role: 'member', status: 'active' }],
        }),
      ).toBe(false);
      expect(mayManageAnnouncement(origin, none)).toBe(false);
    });

    it('lets BC/Moderator pin anything', () => {
      expect(
        mayManageAnnouncement(origin, { ...none, bcOrModerator: true }),
      ).toBe(true);
    });

    it("lets a Manager or Responsible of an active Origin pin, not a plain member or another Group's", () => {
      const role = (group_role: string, id = 7, status = 'active') => ({
        ...none,
        managesAnyGroup: group_role !== 'member',
        groups: [{ id, group_role, status }],
      });
      expect(mayManageAnnouncement(origin, role('responsible'))).toBe(true);
      expect(mayManageAnnouncement(origin, role('manager'))).toBe(true);
      expect(mayManageAnnouncement(origin, role('member'))).toBe(false);
      expect(mayManageAnnouncement(origin, role('manager', 9))).toBe(false);
      expect(
        mayManageAnnouncement(origin, role('manager', 7, 'archived')),
      ).toBe(false);
    });

    it('lets any Group Role holder pin an Organization Group Announcement', () => {
      expect(
        mayManageAnnouncement(orgWide, { ...none, managesAnyGroup: true }),
      ).toBe(true);
      expect(mayManageAnnouncement(orgWide, none)).toBe(false);
    });
  });
});

describe('describeTermen (#909)', () => {
  // Tuesday 29 September 2026, 12:00 in Romania (UTC+3).
  const now = new Date('2026-09-29T09:00:00.000Z');

  it('reads a later Termen as the day and time in Romania', () => {
    expect(describeTermen('2026-10-02T20:59:00.000Z', now)).toEqual({
      state: 'upcoming',
      label: 'Termen',
      when: 'vineri, 2 octombrie, 23:59',
    });
  });

  it('emphasises a Termen within 48 hours and says today or tomorrow', () => {
    expect(describeTermen('2026-09-29T20:59:00.000Z', now)).toEqual({
      state: 'soon',
      label: 'Termen',
      when: 'azi, 23:59',
    });
    expect(describeTermen('2026-09-30T15:40:00.000Z', now)?.when).toBe(
      'mâine, 18:40',
    );
    // 47 hours away, the day after tomorrow: soon, but named by its day.
    expect(describeTermen('2026-10-01T08:00:00.000Z', now)).toMatchObject({
      state: 'soon',
      when: 'joi, 1 octombrie, 11:00',
    });
    expect(describeTermen('2026-10-01T09:00:01.000Z', now)?.state).toBe(
      'upcoming',
    );
  });

  it('reads a passed Termen as expired, never as today', () => {
    expect(describeTermen('2026-09-29T08:00:00.000Z', now)).toEqual({
      state: 'expired',
      label: 'Termen expirat',
      when: 'marți, 29 septembrie, 11:00',
    });
  });

  it('names the year only when it is not this one', () => {
    expect(describeTermen('2027-01-15T10:00:00.000Z', now)?.when).toBe(
      'vineri, 15 ianuarie 2027, 12:00',
    );
    expect(describeTermen('not a date', now)).toBeNull();
  });
});

describe('minLevelLabel (#909)', () => {
  it('says nothing for everyone and names the Role above it (R29b)', () => {
    expect(minLevelLabel(0)).toBeNull();
    expect(minLevelLabel(2)).toBe('Nivel minim: Voluntar Activ');
    expect(minLevelLabel(5)).toBe('Nivel minim: BCE');
  });

  it("carries the row's level into the presentation", () => {
    const item = toAnnouncementPresentation(
      rawRow({ min_level: 3 }),
      groupsById,
    );
    expect(item.minLevel).toBe(3);
    expect(item.minLevelLabel).toBe('Nivel minim: Voluntar cu Drept de Vot');
  });
});
