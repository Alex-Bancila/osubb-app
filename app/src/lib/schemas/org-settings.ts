import { z } from 'zod';
import { charLength, emptyToNull, trimText } from '../normalize';

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
