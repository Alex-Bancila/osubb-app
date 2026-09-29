import { isoToBucharestWallTime } from '../../lib/calendar-time';
import type { Database } from '../../lib/database.types';
import type {
  AnnouncementPresentation,
  AnnouncementPriority,
} from './announcements-presentation';

/**
 * What the Anunț nou sheet holds while a manager writes, as its inputs hold
 * it: the Termen is the `datetime-local` value in Romania's time (#909), the
 * Attached Link the raw label/address pair (ruling R7).
 */
export type AnnouncementDraft = {
  title: string;
  body: string;
  deadline: string;
  minLevel: number;
  priority: AnnouncementPriority;
  linkLabel: string;
  linkUrl: string;
};

export const EMPTY_ANNOUNCEMENT_DRAFT: AnnouncementDraft = {
  title: '',
  body: '',
  deadline: '',
  minLevel: 0,
  priority: 'normal',
  linkLabel: '',
  linkUrl: '',
};

/** The sheet prefilled from a published Announcement (#930). */
export function draftFromAnnouncement(
  announcement: Pick<
    AnnouncementPresentation,
    | 'title'
    | 'body'
    | 'deadline'
    | 'minLevel'
    | 'priority'
    | 'formLabel'
    | 'formUrl'
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
    linkLabel: announcement.formLabel ?? '',
    linkUrl: announcement.formUrl ?? '',
  };
}

export type AnnouncementChanges = Pick<
  Database['public']['Tables']['announcements']['Update'],
  | 'title'
  | 'body'
  | 'deadline'
  | 'min_level'
  | 'priority'
  | 'form_label'
  | 'form_url'
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
    link: { label: string | null; url: string | null };
  },
): AnnouncementChanges {
  const changes: AnnouncementChanges = {};
  if (parsed.title !== initial.title) changes.title = parsed.title;
  if (parsed.body !== initial.body) changes.body = parsed.body;
  if (draft.deadline !== initial.deadline) changes.deadline = parsed.deadline;
  if (draft.minLevel !== initial.minLevel) changes.min_level = draft.minLevel;
  if (draft.priority !== initial.priority) changes.priority = draft.priority;
  // The pair is stored both-or-neither (R7), so a change sends both halves.
  if (
    parsed.link.label !== (initial.linkLabel || null) ||
    parsed.link.url !== (initial.linkUrl || null)
  ) {
    changes.form_label = parsed.link.label;
    changes.form_url = parsed.link.url;
  }
  return changes;
}
