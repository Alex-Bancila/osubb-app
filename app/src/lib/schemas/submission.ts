import { z } from 'zod';
import {
  attachedLinkSchema,
  fieldForReason as linkFieldForReason,
} from './attached-link';
import { optionalText } from './text';

/**
 * A Submission Note (#684, ruling R7) as `submit_task_for_review` stores it:
 * an optional note for the reviewer of at most 1000 characters (blank is no
 * note) and an optional Attached Link, both or neither.
 */
export const submissionSchema = z.object({
  note: optionalText({ max: 1000, tooLong: 'note_too_long' }),
  link: attachedLinkSchema,
});

/** Where each reason `submit_task_for_review` (or this schema) raises is shown. */
export const fieldForReason: Readonly<Record<string, string>> = {
  note_too_long: 'note',
  ...Object.fromEntries(
    Object.entries(linkFieldForReason).map(([reason, field]) => [
      reason,
      `link.${field}`,
    ]),
  ),
};
