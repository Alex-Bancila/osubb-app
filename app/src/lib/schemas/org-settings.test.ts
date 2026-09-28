import { expect, it } from 'vitest';
import { adherenceFormSchema } from './org-settings';

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
