import { expect, it } from 'vitest';
import { adherenceFormSchema, emailQuotaSchema } from './org-settings';

const issue = (result: {
  success: boolean;
  error?: { issues: { message: string }[] };
}) => (result.success ? undefined : result.error?.issues[0]?.message);

it('takes an http(s) adherence-form address of at most 2048 characters, or clears it', () => {
  expect(adherenceFormSchema.parse({ url: '   ' })).toEqual({ url: null });
  expect(issue(adherenceFormSchema.safeParse({ url: 'ftp://x.ro' }))).toBe(
    'link_url_invalid',
  );
  expect(
    issue(
      adherenceFormSchema.safeParse({ url: `https://${'a'.repeat(2041)}` }),
    ),
  ).toBe('link_url_too_long');
  expect(adherenceFormSchema.parse({ url: ' https://forms.ro/a ' })).toEqual({
    url: 'https://forms.ro/a',
  });
});

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
