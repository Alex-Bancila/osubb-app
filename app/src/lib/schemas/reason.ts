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

/**
 * The reason BC writes when it rejects an OSUBB-wide Announcement or Event
 * (spec 2026-10-11): required, at most 1000 characters, under the reason codes
 * `reject_announcement` and `reject_event` raise, so the browser and the
 * server refuse in the same words.
 */
export const rejectionReasonSchema = z.object({
  reason: requiredText({
    required: 'rejection_reason_required',
    max: 1000,
    tooLong: 'rejection_reason_too_long',
  }),
});

export const fieldForRejectionReason: Readonly<Record<string, 'reason'>> = {
  rejection_reason_required: 'reason',
  rejection_reason_too_long: 'reason',
};
