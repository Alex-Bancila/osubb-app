import { z } from 'zod';
import {
  attachedLinkSchema,
  fieldForReason as linkFieldForReason,
} from './attached-link';
import { isId, requiredText } from './text';

/**
 * An Announcement, as `announcements_guard_text` stores it (#673, ruling R8):
 * a title of 3–120 characters, a body of at most 2000, an optional Attached
 * Link, and an Origin Group the author may publish from.
 */
export const announcementSchema = z.object({
  title: requiredText({
    required: 'title_required',
    min: 3,
    tooShort: 'title_too_short',
    max: 120,
    tooLong: 'title_too_long',
  }),
  body: requiredText({
    required: 'body_required',
    max: 2000,
    tooLong: 'body_too_long',
  }),
  groupId: z.number().nullable().refine(isId, 'announcement_group_required'),
  link: attachedLinkSchema,
});

/** Where each reason the announcement guard (or this schema) raises is shown. */
export const fieldForReason: Readonly<Record<string, string>> = {
  title_required: 'title',
  title_too_short: 'title',
  title_too_long: 'title',
  body_required: 'body',
  body_too_long: 'body',
  announcement_group_required: 'groupId',
  ...Object.fromEntries(
    Object.entries(linkFieldForReason).map(([reason, field]) => [
      reason,
      `link.${field}`,
    ]),
  ),
};
