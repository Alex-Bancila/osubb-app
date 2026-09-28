import { z } from 'zod';
import { requiredText } from './text';

/**
 * An Evaluation Period's name, as `open_evaluation_period` (#701) accepts it:
 * trimmed, then 3–120 characters. Blank is the command's own
 * `invalid_period_name`.
 */
export const periodNameSchema = z.object({
  name: requiredText({
    required: 'invalid_period_name',
    min: 3,
    tooShort: 'name_too_short',
    max: 120,
    tooLong: 'name_too_long',
  }),
});

/** Where each reason `open_evaluation_period` (or this schema) raises is shown. */
export const periodNameFieldForReason: Readonly<Record<string, 'name'>> = {
  invalid_period_name: 'name',
  name_too_short: 'name',
  name_too_long: 'name',
};

/** Postgres `integer`'s ceiling: `set_promotion_rule` takes one. */
const INT_MAX = 2_147_483_647;

/**
 * The initial Promotion Threshold `set_promotion_rule` (#702) writes: a whole
 * number of Task Points, at least 1 (`promotion_rules_initial_threshold_range_ck`).
 * The field is text, so the digits are checked before the number is.
 */
export const initialThresholdSchema = z.object({
  threshold: z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > INT_MAX)
        ctx.addIssue({ code: 'custom', message: 'invalid_initial_threshold' });
    })
    .transform(Number),
});

export const initialThresholdFieldForReason: Readonly<
  Record<string, 'threshold'>
> = {
  invalid_initial_threshold: 'threshold',
};
