import type { AttachedLinkValue } from '../../components/attached-link/AttachedLinkFields';
import { isoToBucharestWallTime } from '../../lib/calendar-time';
import type { Database } from '../../lib/database.types';
import {
  sameAttachedLinks,
  type AttachedLink,
} from '../../lib/schemas/attached-link';
import type {
  AnnouncementPresentation,
  AnnouncementPriority,
} from './announcements-presentation';

/**
 * What the Anunț nou sheet holds while a manager writes, as its inputs hold
 * it: the Termen is the `datetime-local` value in Romania's time (#909), the
 * Attached Links the raw label/address rows (ruling R46).
 */
export type AnnouncementDraft = {
  title: string;
  body: string;
  deadline: string;
  minLevel: number;
  priority: AnnouncementPriority;
  links: AttachedLinkValue[];
};

export const EMPTY_ANNOUNCEMENT_DRAFT: AnnouncementDraft = {
  title: '',
  body: '',
  deadline: '',
  minLevel: 0,
  priority: 'normal',
  links: [],
};

/** The sheet prefilled from a published Announcement (#930). */
export function draftFromAnnouncement(
  announcement: Pick<
    AnnouncementPresentation,
    'title' | 'body' | 'deadline' | 'minLevel' | 'priority' | 'links'
  >,
): AnnouncementDraft {
  return {
    title: announcement.title,
    body: announcement.body,
    deadline: announcement.deadline
      ? isoToBucharestWallTime(announcement.deadline)
      : '',
    minLevel: announcement.minLevel,
    priority: announcement.priority,
    links: announcement.links.map((link) => ({ ...link })),
  };
}

export type AnnouncementChanges = Pick<
  Database['public']['Tables']['announcements']['Update'],
  'title' | 'body' | 'deadline' | 'min_level' | 'priority' | 'links'
>;

/**
 * Only what the manager changed (#930), from the parsed draft: the Group,
 * Audience, author, date and pin are never part of an edit. The Termen counts
 * as changed when its Romanian wall-clock minute differs, so an untouched
 * Termen that has since passed is never sent (R8 judges it only at creation).
 */
export function announcementChanges(
  initial: AnnouncementDraft,
  draft: AnnouncementDraft,
  parsed: {
    title: string;
    body: string;
    deadline: string | null;
    links: AttachedLink[];
  },
): AnnouncementChanges {
  const changes: AnnouncementChanges = {};
  if (parsed.title !== initial.title) changes.title = parsed.title;
  if (parsed.body !== initial.body) changes.body = parsed.body;
  if (draft.deadline !== initial.deadline) changes.deadline = parsed.deadline;
  if (draft.minLevel !== initial.minLevel) changes.min_level = draft.minLevel;
  if (draft.priority !== initial.priority) changes.priority = draft.priority;
  // The list is replaced whole (R46): any change to a row, its order or
  // their number sends every link the manager kept.
  if (!sameAttachedLinks(parsed.links, initial.links))
    changes.links = parsed.links;
  return changes;
}
