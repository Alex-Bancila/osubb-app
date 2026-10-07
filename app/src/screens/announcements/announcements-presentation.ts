import { ro } from 'date-fns/locale';
import { formatInTimeZone } from 'date-fns-tz';
import { BUCHAREST_TIME_ZONE, bucharestDayKey } from '../../lib/calendar-time';
import type { Database } from '../../lib/database.types';
import { minimumLevelText } from '../../lib/minimum-level';
import {
  attachedLinksFrom,
  type AttachedLink,
} from '../../lib/schemas/attached-link';
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
  /** The Organization Group: its chip reads "OSUBB" whatever its stored name. */
  isOrganization?: boolean;
};

/**
 * The Origin chip (B34): the Group's name, never its short code ("EDU");
 * the Organization Group reads "OSUBB".
 */
export function originLabel(group: AnnouncementGroup): string {
  return group.isOrganization ? 'OSUBB' : group.name;
}

export type AnnouncementPresentation = {
  id: number;
  title: string;
  body: string;
  groupId: number;
  group: AnnouncementGroup;
  audience: string;
  /**
   * "Doar Educațional" for a local Audience. Null when everyone receives it
   * (an organization Audience, or the Organization Group's own members): the
   * Origin chip already says whose it is (B34).
   */
  audienceLabel: string | null;
  /** The author (`created_by`) as a Member Card button; null on a legacy row without one. */
  authorMember: MemberIdentity | null;
  priority: AnnouncementPriority;
  pinned: boolean;
  /** Its Attached Links (ruling R46), in order; empty when there are none. */
  links: AttachedLink[];
  publishedAt: string;
  publishedLabel: string;
  /** The optional Termen (#909), an ISO instant; null when there is none. */
  deadline: string | null;
  /** The Minimum Level (#909); 0 is everyone in the Audience. */
  minLevel: number;
  /** "Nivel minim: Voluntar Activ", or null at 0 (it says nothing then). */
  minLevelLabel: string | null;
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

/** Only Important and Critic earn a mark on the card; "Normal" says nothing (B34). */
export function showsPriority(priority: AnnouncementPriority): boolean {
  return priority === 'critical' || priority === 'important';
}

function localAudienceLabel(
  audience: string,
  origin: Group | undefined,
): string | null {
  if (audience === 'org') return null;
  if (!origin) return 'Doar grupul';
  // Every Member belongs to the Organization Group: its local Audience is everyone.
  if (origin.is_organization) return null;
  return `Doar ${origin.name}`;
}

export function formatAnnouncementDate(instant: string): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return '—';

  return formatInTimeZone(date, BUCHAREST_TIME_ZONE, 'd MMMM yyyy, HH:mm', {
    locale: ro,
  });
}

/** "Nivel minim: BCE" — shown only above Recrut, by the Role's name (R29b). */
export function minLevelLabel(level: number): string | null {
  return level > 0 ? `Nivel minim: ${minimumLevelText(level)}` : null;
}

export type TermenState = 'upcoming' | 'soon' | 'expired';

export type TermenPresentation = {
  state: TermenState;
  /** "Termen" while it runs, "Termen expirat" once it has passed. */
  label: string;
  /** "vineri, 2 octombrie, 23:59"; "azi, 23:59" / "mâine, 18:40" when close. */
  when: string;
};

/** Within this many hours a running Termen is emphasised (#909). */
export const TERMEN_SOON_HOURS = 48;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How the card shows a Termen (#909), always in Romania's time: past it reads
 * "Termen expirat"; within 48 hours it is `soon`, and today or tomorrow says
 * so ("azi", "mâine"); the year appears only when it is not this year's.
 */
export function describeTermen(
  deadline: string,
  now: Date = new Date(),
): TermenPresentation | null {
  const at = new Date(deadline);
  if (Number.isNaN(at.getTime())) return null;
  const left = at.getTime() - now.getTime();
  const state: TermenState =
    left < 0
      ? 'expired'
      : left <= TERMEN_SOON_HOURS * 60 * 60 * 1000
        ? 'soon'
        : 'upcoming';

  const time = formatInTimeZone(at, BUCHAREST_TIME_ZONE, 'HH:mm');
  const day = bucharestDayKey(at);
  const relative =
    state === 'expired'
      ? null
      : day === bucharestDayKey(now)
        ? 'azi'
        : day === bucharestDayKey(new Date(now.getTime() + DAY_MS))
          ? 'mâine'
          : null;
  const sameYear =
    formatInTimeZone(at, BUCHAREST_TIME_ZONE, 'yyyy') ===
    formatInTimeZone(now, BUCHAREST_TIME_ZONE, 'yyyy');
  const date = formatInTimeZone(
    at,
    BUCHAREST_TIME_ZONE,
    sameYear ? 'EEEE, d MMMM' : 'EEEE, d MMMM yyyy',
    { locale: ro },
  );

  return {
    state,
    label: state === 'expired' ? 'Termen expirat' : 'Termen',
    when: `${relative ?? date}, ${time}`,
  };
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
        isOrganization: origin.is_organization,
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
    audienceLabel: localAudienceLabel(row.audience, origin),
    authorMember: row.created_by
      ? (members?.get(row.created_by) ?? {
          memberId: row.created_by,
          // Until the directory answers.
          fullName: 'Membru OSUBB',
        })
      : null,
    priority: row.priority,
    pinned: row.pinned,
    links: attachedLinksFrom(row.links),
    publishedAt: row.published_at,
    publishedLabel: formatAnnouncementDate(row.published_at),
    deadline: row.deadline ?? null,
    minLevel: row.min_level ?? 0,
    minLevelLabel: minLevelLabel(row.min_level ?? 0),
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
 * by live rank (`my_capabilities().manage_roles`, level ≥ 6, not the token's
 * claim), or — for a local Audience only — a Manager or Responsible on the
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
    /** BC/Moderator by live rank (`useCapability('manageRoles')`). */
    bcOrModerator: boolean;
    groups: readonly { id: number; group_role: string }[] | undefined;
  },
): boolean {
  if (!viewer.memberId) return false;
  if (announcement.authorMember?.memberId === viewer.memberId) return true;
  if (viewer.bcOrModerator) return true;
  if (announcement.audience !== 'local') return false;
  return (viewer.groups ?? []).some(
    (group) =>
      group.id === announcement.groupId &&
      (group.group_role === 'manager' || group.group_role === 'responsible'),
  );
}

/**
 * Whether to offer Editează, "Fixează anunțul" / "Anulează fixarea" and
 * Șterge (#857, #930): the client copy of `announcements_update` and
 * `announcements_delete`, whose predicates are the same. BC/Moderator
 * (`private.can_manage_group_work`'s level ≥ 6 arm, any Group status); a
 * Manager or Responsible on the Origin's path while the Origin is active (the
 * same function's other arm — `my_groups()` carries the Roles inherited from a
 * Group above); and, for an Organization Group Announcement, anyone holding a
 * Group Role anywhere (`private.holds_any_group_role()`, i.e.
 * `my_capabilities().manages_any_group`). Being the author grants nothing by
 * itself. Presentation only: the policies decide.
 */
export function mayManageAnnouncement(
  announcement: Pick<AnnouncementPresentation, 'groupId' | 'group'>,
  viewer: {
    /** BC/Moderator by live rank (`useCapability('manageRoles')`). */
    bcOrModerator: boolean;
    /** Holds a Group Role anywhere (`useCapability('managesAnyGroup')`). */
    managesAnyGroup: boolean;
    groups:
      readonly { id: number; group_role: string; status: string }[] | undefined;
  },
): boolean {
  if (viewer.bcOrModerator) return true;
  if (announcement.group.isOrganization === true && viewer.managesAnyGroup)
    return true;
  return (viewer.groups ?? []).some(
    (group) =>
      group.id === announcement.groupId &&
      group.status === 'active' &&
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
