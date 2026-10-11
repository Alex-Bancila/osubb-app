import { formatDistance } from 'date-fns';
import { ro } from 'date-fns/locale';
import { formatInTimeZone } from 'date-fns-tz';
import {
  AlarmClock,
  CalendarDays,
  Info,
  ListTodo,
  Megaphone,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { BUCHAREST_TIME_ZONE } from '../../lib/calendar-time';
import { inAppPath } from '../../lib/links';
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

/* Group membership, Appointments and Applications travel as `system`
   notifications (the enum has no Group kind), so the row names them by what
   they are about (#858, B37). A link to a Group page says so; the titles the
   server writes cover the ones that carry no link (an archived or Private
   Group, a raised Minimum Level). */
const GROUP_META: NotificationKindMeta = { label: 'Grupuri', icon: Users };
const GROUP_LINK = /^\/(?:administrare\/)?grupuri(?:[/?#]|$)/;
const GROUP_TITLE_PREFIXES = [
  'Ai fost adăugat în ',
  'Nu mai faci parte din ',
  'Numire în ',
  'Numire încheiată în ',
  'Nivel minim actualizat: ',
  'Cerere de înscriere: ',
  'Cerere acceptată: ',
  'Cerere respinsă: ',
];

/** Whether a `system` notification is about a Group ("Grupuri"). */
export function isGroupNotification(
  row: Pick<NotificationRow, 'kind' | 'title' | 'link'>,
): boolean {
  if (row.kind !== 'system') return false;
  if (row.link && GROUP_LINK.test(row.link)) return true;
  return GROUP_TITLE_PREFIXES.some((prefix) => row.title.startsWith(prefix));
}

/** The icon and its name for one row: its kind, or "Grupuri" for Group news. */
export function notificationMeta(
  row: Pick<NotificationRow, 'kind' | 'title' | 'link'>,
): NotificationKindMeta {
  return isGroupNotification(row) ? GROUP_META : notificationKindMeta(row.kind);
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

const shortDateFormatter = new Intl.DateTimeFormat('ro-RO', {
  timeZone: BUCHAREST_TIME_ZONE,
  calendar: 'gregory',
  day: 'numeric',
  month: 'short',
});

const shortDateWithYearFormatter = new Intl.DateTimeFormat('ro-RO', {
  timeZone: BUCHAREST_TIME_ZONE,
  calendar: 'gregory',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/**
 * `acum`, `15 min`, `2 h`, `3 zile`, then the day (`14 oct.`, with the year
 * once it is more than a year back) — the age as it fits at the end of a
 * title's line on a phone. The sentence (`formatNotificationAge`) and the
 * exact moment stay on the same element for whoever needs them.
 */
export function formatNotificationShortAge(
  instant: string,
  now: Date = new Date(),
): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return '—';

  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return 'acum';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? '1 zi' : `${days} zile`;
  return (days < 365 ? shortDateFormatter : shortDateWithYearFormatter).format(
    date,
  );
}

/**
 * Notification links are in-app routes — `/tracker/12`, `/grupuri/3`,
 * `/administrare/grupuri/3`, `/calendar`. Anything else (absent, empty, or an
 * absolute URL that would leave the app) is treated as "no link": the row
 * still renders and still marks itself read, it simply goes nowhere. The rule
 * is the service worker's (`inAppPath` in `lib/links.ts`): a tab or new line
 * inside `//`, or a backslash, would otherwise resolve to another host, and
 * React Router falls back to a full-page load for a cross-origin URL.
 */
export function inAppLink(link: string | null): string | null {
  return inAppPath(link, window.location.origin);
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
  /** The age in a few characters, for the end of the title's line. */
  shortAgeLabel: string;
  momentLabel: string;
};

export function toNotificationPresentation(
  row: NotificationRow,
  now: Date = new Date(),
): NotificationPresentation {
  const meta = notificationMeta(row);

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
    shortAgeLabel: formatNotificationShortAge(row.created_at, now),
    momentLabel: formatNotificationMoment(row.created_at),
  };
}

/** `3 notificări necitite` — the badge's accessible name, in words. */
export function unreadBadgeLabel(count: number): string {
  return count === 1 ? '1 notificare necitită' : `${count} notificări necitite`;
}

/**
 * The receipt of "Marchează toate ca citite" (#1012): "Am marcat o notificare
 * ca citită", "… 3 notificări ca citite", "… 20 de notificări ca citite" —
 * Romanian puts "de" between a number and its noun when its last two digits
 * are 00 or 20-99.
 */
export function markedAllReceipt(count: number): string {
  if (count === 1) return 'Am marcat o notificare ca citită.';
  const lastTwo = count % 100;
  const de = count !== 0 && (lastTwo === 0 || lastTwo >= 20) ? 'de ' : '';
  return `Am marcat ${count} ${de}notificări ca citite.`;
}
