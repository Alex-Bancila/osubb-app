import { z } from 'zod';
import {
  attachedLinkSchema,
  fieldForReason as linkFieldForReason,
} from './attached-link';
import { isId, requiredText } from './text';

/**
 * An Announcement, as `announcements_guard_text` stores it (#673, ruling R8):
 * a title of 3–120 characters, a body of at most 2000, an optional Attached
 * Link, an Origin Group the author may publish from, and an optional Termen
 * that is not in the past (#909, `announcements_guard_deadline`). `deadline`
 * is an ISO instant, `null` for none, or `''` for a wall-clock time that does
 * not exist in Romania.
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
  deadline: z
    .string()
    .nullable()
    .superRefine((deadline, ctx) => {
      if (deadline === null) return;
      const time = deadline ? Date.parse(deadline) : Number.NaN;
      if (!Number.isFinite(time))
        ctx.addIssue({ code: 'custom', message: 'deadline_invalid' });
      else if (time < Date.now())
        ctx.addIssue({ code: 'custom', message: 'deadline_in_past' });
    }),
});

/** Where each reason the announcement guard (or this schema) raises is shown. */
export const fieldForReason: Readonly<Record<string, string>> = {
  title_required: 'title',
  title_too_short: 'title',
  title_too_long: 'title',
  body_required: 'body',
  body_too_long: 'body',
  announcement_group_required: 'groupId',
  deadline_invalid: 'deadline',
  deadline_in_past: 'deadline',
  ...Object.fromEntries(
    Object.entries(linkFieldForReason).map(([reason, field]) => [
      reason,
      `link.${field}`,
    ]),
  ),
};
