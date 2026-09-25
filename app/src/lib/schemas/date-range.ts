import { z } from 'zod';

/** A calendar day as `<input type="date">` and the Work Filter's URL hold it. */
export const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export type DateRangeValues = { from?: string; to?: string };

/**
 * The Work Filter's **De la** / **Până la** pair (#678, ruling R8): either end
 * may be empty — no bound — and when both are set **Până la** is not before
 * **De la**. The same day twice is one whole day, not an error. It is the
 * browser twin of #677's `private.require_date_range` (PT400
 * `invalid_date_range`), so the message a member reads is the one the server
 * refusal would carry.
 *
 * The days themselves are already well formed: `parseWorkFilter` drops a
 * malformed one from the URL, and a date input only ever reports a real day or
 * nothing. Two ISO days compare correctly as strings.
 */
export const dateRangeSchema = z
  .object({ from: z.string().optional(), to: z.string().optional() })
  .superRefine((range, ctx) => {
    if (range.from && range.to && range.to < range.from)
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'invalid_date_range',
      });
  });

/** Where a date-range refusal is shown: under **Până la**. */
export const fieldForReason: Readonly<Record<string, keyof DateRangeValues>> = {
  invalid_date_range: 'to',
};
