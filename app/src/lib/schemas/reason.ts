import { z } from 'zod';
import { requiredText } from './text';

/**
 * A reason recorded on a row (#673, ruling R8): required, at most 1000
 * characters — `give_up_task`, `reopen_task`, `cancel_task`, `cancel_event`.
 */
export const reasonText = requiredText({
  required: 'reason_required',
  max: 1000,
  tooLong: 'reason_too_long',
});

export const reasonSchema = z.object({ reason: reasonText });

/** Where each reason about a written reason is shown. */
export const fieldForReason: Readonly<Record<string, 'reason'>> = {
  reason_required: 'reason',
  reason_too_long: 'reason',
};
