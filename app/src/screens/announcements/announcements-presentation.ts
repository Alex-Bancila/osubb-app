import { ro } from 'date-fns/locale';
import { formatInTimeZone } from 'date-fns-tz';
import { BUCHAREST_TIME_ZONE } from '../../lib/calendar-time';
import type { Database } from '../../lib/database.types';
import type { MemberIdentity } from '../../components/member/member-identity';
import type { Group } from '../../queries/reference';

export type AnnouncementPriority =
  Database['public']['Enums']['announce_priority'];

export type RawAnnouncementRow =
  Database['public']['Tables']['announcements']['Row'] & {
    announcement_reads?: { read_at: string }[] | null;
  };

export type AnnouncementGroup = {
  id: number;
  name: string;
  short?: string;
  color?: string | null;
};

export type AnnouncementPresentation = {
  id: number;
  title: string;
  body: string;
  groupId: number;
  group: AnnouncementGroup;
  audience: string;
  audienceLabel: string;
  author: string | null;
  /** The author as a Member Card button; null on a legacy row without `created_by`. */
  authorMember: MemberIdentity | null;
  priority: AnnouncementPriority;
  category: string | null;
  pinned: boolean;
  formLabel: string | null;
  formUrl: string | null;
  publishedAt: string;
  publishedLabel: string;
  isRead: boolean;
};

export type PriorityMeta = {
  label: string;
  variant: 'destructive' | 'secondary' | 'outline';
};

const PRIORITY_META: Record<AnnouncementPriority, PriorityMeta> = {
  critical: { label: 'Critic', variant: 'destructive' },
  important: { label: 'Important', variant: 'secondary' },
  normal: { label: 'Normal', variant: 'outline' },
};

export function priorityMeta(priority: AnnouncementPriority): PriorityMeta {
  return PRIORITY_META[priority] ?? { label: priority, variant: 'outline' };
}

export function formatAnnouncementDate(instant: string): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return '—';

  return formatInTimeZone(date, BUCHAREST_TIME_ZONE, 'd MMMM yyyy, HH:mm', {
    locale: ro,
  });
}

export function toAnnouncementPresentation(
  row: RawAnnouncementRow,
  groupsById?: ReadonlyMap<number, Group>,
  members?: ReadonlyMap<string, MemberIdentity>,
): AnnouncementPresentation {
  const origin = groupsById?.get(row.group_id);
  const group: AnnouncementGroup = origin
    ? {
        id: origin.id,
        name: origin.name,
        short: origin.short ?? undefined,
        color: origin.color,
      }
    : { id: row.group_id, name: 'Grup', short: 'GRUP' };

  const isRead = Array.isArray(row.announcement_reads)
    ? row.announcement_reads.length > 0
    : false;

  return {
    id: row.id,
    title: row.title,
    body: row.body,
    groupId: row.group_id,
    group,
    audience: row.audience,
    audienceLabel: row.audience === 'org' ? 'Toată organizația' : 'Doar grupul',
    author: row.author,
    authorMember: row.created_by
      ? (members?.get(row.created_by) ?? {
          memberId: row.created_by,
          // The stored byline stands in until the directory answers.
          fullName: row.author?.trim() || 'Membru OSUBB',
        })
      : null,
    priority: row.priority,
    category: row.category,
    pinned: row.pinned,
    formLabel: row.form_label,
    formUrl: row.form_url,
    publishedAt: row.published_at,
    publishedLabel: formatAnnouncementDate(row.published_at),
    isRead,
  };
}

/**
 * Ruling R15: three bands, newest first inside each — pinned (read or not),
 * then unread, then read. Read state is per Member, so the order is decided
 * here rather than by the server's `pinned, published_at` sort.
 */
function band(item: AnnouncementPresentation): number {
  if (item.pinned) return 0;
  return item.isRead ? 2 : 1;
}

export function sortAnnouncements(
  items: AnnouncementPresentation[],
): AnnouncementPresentation[] {
  return [...items].sort(
    (left, right) =>
      band(left) - band(right) ||
      Date.parse(right.publishedAt) - Date.parse(left.publishedAt),
  );
}

/** `3 anunțuri necitite` — the Anunțuri badge's accessible name, in words. */
export function unreadAnnouncementsLabel(count: number): string {
  return count === 1 ? '1 anunț necitit' : `${count} anunțuri necitite`;
}

/**
 * Whether to ask `announcement_readers` at all (R15): the author, BC/Moderator
 * (level ≥ 6), or — for a local Audience only — a Manager or Responsible on the
 * Origin's path. `my_groups()` already carries the Roles inherited from an
 * ancestor. The server decides regardless; this only spares the others a
 * request that can only answer PT404.
 */
export function mayAskForReaders(
  announcement: Pick<
    AnnouncementPresentation,
    'authorMember' | 'audience' | 'groupId'
  >,
  viewer: {
    memberId: string | undefined;
    level: number | undefined;
    groups: readonly { id: number; group_role: string }[] | undefined;
  },
): boolean {
  if (!viewer.memberId) return false;
  if (announcement.authorMember?.memberId === viewer.memberId) return true;
  if ((viewer.level ?? 0) >= 6) return true;
  if (announcement.audience !== 'local') return false;
  return (viewer.groups ?? []).some(
    (group) =>
      group.id === announcement.groupId &&
      (group.group_role === 'manager' || group.group_role === 'responsible'),
  );
}

export type AnnouncementReader = {
  member: MemberIdentity;
  /** Null while the recipient has not opened the Announcement. */
  readAt: string | null;
};

/** `Citit de 4 din 12` — the Audience that has opened it, over the whole Audience. */
export function readersSummary(readers: readonly AnnouncementReader[]): {
  read: AnnouncementReader[];
  unread: AnnouncementReader[];
  label: string;
} {
  const read = readers.filter((reader) => reader.readAt !== null);
  const unread = readers.filter((reader) => reader.readAt === null);
  return {
    read,
    unread,
    label: `Citit de ${read.length} din ${readers.length}`,
  };
}

export function countUnreadAnnouncements(
  items: AnnouncementPresentation[],
): number {
  return items.filter((item) => !item.isRead).length;
}

export function getUnreadCriticalAnnouncement(
  items: AnnouncementPresentation[],
): AnnouncementPresentation | null {
  return (
    items.find((item) => item.priority === 'critical' && !item.isRead) ?? null
  );
}
