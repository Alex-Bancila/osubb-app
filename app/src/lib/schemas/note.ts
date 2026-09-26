import { z } from 'zod';
import { optionalText, requiredText } from './text';

/**
 * A decision or feedback note (#673, ruling R8): required, at most 1000
 * characters — `return_task_to_progress` and `reject_completed_work_request`.
 */
export const noteText = requiredText({
  required: 'note_required',
  max: 1000,
  tooLong: 'note_too_long',
});

export const noteSchema = z.object({ note: noteText });

/**
 * An optional note (#724, ruling R8): blank is no note, otherwise at most 1000
 * characters -- `apply_to_group` and `decide_group_application`.
 */
export const optionalNoteSchema = z.object({
  note: optionalText({ max: 1000, tooLong: 'note_too_long' }),
});

/** Where each reason about a note is shown. */
export const fieldForReason: Readonly<Record<string, 'note'>> = {
  note_required: 'note',
  note_too_long: 'note',
};
