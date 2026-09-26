import { z } from 'zod';
import { requiredText } from './text';

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

/** Where each reason about a note is shown. */
export const fieldForReason: Readonly<Record<string, 'note'>> = {
  note_required: 'note',
  note_too_long: 'note',
};
