import { expect, it } from 'vitest';
import { emailQuotaSchema } from './org-settings';

const issue = (result: {
  success: boolean;
  error?: { issues: { message: string }[] };
}) => (result.success ? undefined : result.error?.issues[0]?.message);

it('takes the daily email quota as a whole number 0-99999, never blank (#932)', () => {
  expect(emailQuotaSchema.parse({ quota: ' 0 ' })).toEqual({ quota: '0' });
  expect(emailQuotaSchema.parse({ quota: '090' })).toEqual({ quota: '90' });
  expect(emailQuotaSchema.parse({ quota: '99999' })).toEqual({
    quota: '99999',
  });
  for (const bad of ['', '  ', '-1', '2.5', '1e3', '100000', 'nouăzeci'])
    expect(issue(emailQuotaSchema.safeParse({ quota: bad }))).toBe(
      'email_daily_quota_invalid',
    );
});
