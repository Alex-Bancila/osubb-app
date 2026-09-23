import { ro } from 'date-fns/locale';
import { formatInTimeZone } from 'date-fns-tz';
import { BUCHAREST_TIME_ZONE } from '../../lib/calendar-time';
import type { Database } from '../../lib/database.types';
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

export function sortAnnouncements(
  items: AnnouncementPresentation[],
): AnnouncementPresentation[] {
  return [...items].sort((left, right) => {
    // Pinned announcements come first
    if (left.pinned !== right.pinned) {
      return left.pinned ? -1 : 1;
    }
    // Newest publication date first
    return Date.parse(right.publishedAt) - Date.parse(left.publishedAt);
  });
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
