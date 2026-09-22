import { expect, it } from 'vitest';
import { queryErrorCode, queryErrorMessage } from './query-error';
it('recognizes structured database failures without exposing SQL details', () => {
  expect(queryErrorCode({ code: '42501' })).toBe('42501');
  expect(queryErrorMessage({ code: '42501', message: 'private SQL' })).toBe(
    'Nu ai permisiunea să accesezi aceste date.',
  );
});
it.each([
  null,
  undefined,
  'error',
  42,
  new Error('internal detail'),
  { code: 5 },
])('handles unstructured failures %s', (error) => {
  expect(queryErrorCode(error)).toBeUndefined();
  expect(queryErrorMessage(error, 'Încearcă din nou.')).toBe(
    'Încearcă din nou.',
  );
});
