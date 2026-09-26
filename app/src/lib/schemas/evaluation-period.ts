import { z } from 'zod';
import { charLength, emptyToNull, trimText } from '../normalize';
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

/**
 * The adherence-form address (`org_settings.adherence_form_url`, #681): empty
 * clears it (`null`), otherwise an `http://` or `https://` address of at most
 * 2048 characters — the Attached Link's address rule from #674's kit, which is
 * the one `set_org_setting` applies (`private.is_http_url`).
 */
export const adherenceFormSchema = z.object({
  url: z
    .string()
    .nullish()
    .transform((value) => emptyToNull(trimText(value)))
    .superRefine((value, ctx) => {
      if (value === null) return;
      if (charLength(value) > 2048)
        ctx.addIssue({ code: 'custom', message: 'link_url_too_long' });
      else if (!/^https?:\/\//.test(value))
        ctx.addIssue({ code: 'custom', message: 'link_url_invalid' });
    }),
});

export const adherenceFormFieldForReason: Readonly<Record<string, 'url'>> = {
  link_url_invalid: 'url',
  link_url_too_long: 'url',
  invalid_org_setting_value: 'url',
  value_too_long: 'url',
};
