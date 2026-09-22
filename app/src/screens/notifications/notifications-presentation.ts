import { formatDistance } from 'date-fns';
import { ro } from 'date-fns/locale';
import { formatInTimeZone } from 'date-fns-tz';
import {
  AlarmClock,
  CalendarDays,
  Info,
  ListTodo,
  Megaphone,
  type LucideIcon,
} from 'lucide-react';
import { BUCHAREST_TIME_ZONE } from '../../lib/calendar-time';
import type { Database } from '../../lib/database.types';
import type { NotificationRow } from '../../queries/notifications';

export type NotificationKind = Database['public']['Enums']['noti_kind'];

export type NotificationKindMeta = {
  /** Read out to screen readers in place of the decorative icon. */
  label: string;
  icon: LucideIcon;
};

/* One icon and one word per `noti_kind`. Keyed by the enum itself, so a new
   kind in the database is a type error here rather than a blank row. */
const KIND_META: Record<NotificationKind, NotificationKindMeta> = {
  announce: { label: 'Anunț', icon: Megaphone },
  deadline: { label: 'Termen limită', icon: AlarmClock },
  event: { label: 'Eveniment', icon: CalendarDays },
  task: { label: 'Task', icon: ListTodo },
  system: { label: 'Sistem', icon: Info },
};

export function notificationKindMeta(
  kind: NotificationKind,
): NotificationKindMeta {
  return KIND_META[kind] ?? { label: 'Sistem', icon: Info };
}

/** `20 septembrie 2026, 15:00` — the exact moment, in Romanian wall time. */
export function formatNotificationMoment(instant: string): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return '—';

  return formatInTimeZone(date, BUCHAREST_TIME_ZONE, 'd MMMM yyyy, HH:mm', {
    locale: ro,
  });
}

/**
 * `15 minute în urmă` — what a member actually scans a notification list for.
 *
 * The distance itself is timezone-free, which is the point: the exact Bucharest
 * moment stays available on the same element (`formatNotificationMoment`) for
 * anyone who needs it, and neither number changes with the device's clock zone.
 */
export function formatNotificationAge(
  instant: string,
  now: Date = new Date(),
): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return '—';

  return formatDistance(date, now, { addSuffix: true, locale: ro });
}

/**
 * Notification links are in-app routes — `/tracker/12`, `/grupuri/3`,
 * `/administrare/grupuri/3`, `/calendar`. Anything else (absent, empty, or an
 * absolute URL that would leave the app) is treated as "no link": the row
 * still renders and still marks itself read, it simply goes nowhere.
 */
export function inAppLink(link: string | null): string | null {
  if (!link) return null;
  const trimmed = link.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return null;
  return trimmed;
}

export type NotificationPresentation = {
  id: number;
  kind: NotificationKind;
  kindLabel: string;
  icon: LucideIcon;
  title: string;
  body: string | null;
  critical: boolean;
  isRead: boolean;
  link: string | null;
  createdAt: string;
  ageLabel: string;
  momentLabel: string;
};

export function toNotificationPresentation(
  row: NotificationRow,
  now: Date = new Date(),
): NotificationPresentation {
  const meta = notificationKindMeta(row.kind);

  return {
    id: row.id,
    kind: row.kind,
    kindLabel: meta.label,
    icon: meta.icon,
    title: row.title,
    body: row.body,
    critical: row.critical,
    isRead: row.read,
    link: inAppLink(row.link),
    createdAt: row.created_at,
    ageLabel: formatNotificationAge(row.created_at, now),
    momentLabel: formatNotificationMoment(row.created_at),
  };
}

/** `3 notificări necitite` — the badge's accessible name, in words. */
export function unreadBadgeLabel(count: number): string {
  return count === 1 ? '1 notificare necitită' : `${count} notificări necitite`;
}
