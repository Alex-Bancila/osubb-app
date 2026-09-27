import { expect, it } from 'vitest';
import { initialThresholdSchema, periodNameSchema } from './evaluation-period';

const issue = (result: {
  success: boolean;
  error?: { issues: { message: string }[] };
}) => (result.success ? undefined : result.error?.issues[0]?.message);

it('measures a Period name trimmed, 3 to 120 characters, as open_evaluation_period does', () => {
  expect(issue(periodNameSchema.safeParse({ name: '   ' }))).toBe(
    'invalid_period_name',
  );
  expect(issue(periodNameSchema.safeParse({ name: ' ab ' }))).toBe(
    'name_too_short',
  );
  expect(issue(periodNameSchema.safeParse({ name: 'p'.repeat(121) }))).toBe(
    'name_too_long',
  );
  expect(periodNameSchema.parse({ name: '  Toamna 2026 ' })).toEqual({
    name: 'Toamna 2026',
  });
});

it('takes a whole initial threshold of at least 1', () => {
  for (const threshold of ['', '0', '-3', '2.5', 'abc', '2147483648'])
    expect(
      issue(initialThresholdSchema.safeParse({ threshold })),
      threshold,
    ).toBe('invalid_initial_threshold');
  expect(initialThresholdSchema.parse({ threshold: ' 40 ' })).toEqual({
    threshold: 40,
  });
});
