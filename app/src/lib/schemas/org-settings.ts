import { z } from 'zod';

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
