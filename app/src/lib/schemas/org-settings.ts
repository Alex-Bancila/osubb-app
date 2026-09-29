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

/**
 * The daily email quota (`org_settings.email_daily_quota`, #775): a whole
 * number from 0 to 99999, never blank — `set_org_setting` refuses anything
 * else, and 0 pauses the Email Digest.
 */
export const emailQuotaSchema = z.object({
  quota: z.string().transform((value, ctx) => {
    const text = value.trim();
    if (!/^\d{1,5}$/.test(text)) {
      ctx.addIssue({ code: 'custom', message: 'email_daily_quota_invalid' });
      return z.NEVER;
    }
    return String(Number(text));
  }),
});

export const emailQuotaFieldForReason: Readonly<Record<string, 'quota'>> = {
  email_daily_quota_invalid: 'quota',
  invalid_org_setting_value: 'quota',
};
