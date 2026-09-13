import { describe, expect, it } from 'vitest';
import { toAuthErrorMessage } from './auth-error-message';

const MESSAGE = {
  expired: 'Linkul a expirat sau a fost deja folosit. Cere unul nou.',
  invalid: 'Linkul de conectare nu este valid. Cere unul nou.',
  rateLimit:
    'Prea multe cereri într-un timp scurt. Încearcă din nou peste un minut.',
  network:
    'Nu te-am putut conecta la internet. Verifică conexiunea și încearcă din nou.',
  unknown:
    'Nu am putut finaliza conectarea. Încearcă din nou; dacă problema persistă, anunță BC.',
} as const;

describe('toAuthErrorMessage', () => {
  it.each([
    [{ code: 'OTP_EXPIRED' }, MESSAGE.expired],
    [{ message: 'The magic link has expired' }, MESSAGE.expired],
    [{ code: 'invalid_token' }, MESSAGE.invalid],
    [{ message: 'Link is not valid' }, MESSAGE.invalid],
    [{ code: 'too_many_requests' }, MESSAGE.rateLimit],
    [{ status: 429 }, MESSAGE.rateLimit],
    [{ message: 'Too many emails' }, MESSAGE.rateLimit],
    [{ code: 'offline' }, MESSAGE.network],
    [{ status: 0 }, MESSAGE.network],
    [{ message: 'Failed to fetch' }, MESSAGE.network],
  ])('classifies a safe message from %o', (failure, expected) => {
    expect(toAuthErrorMessage(failure)).toBe(expected);
  });

  it.each([
    'provider returned an unfamiliar response',
    undefined,
    null,
    17,
    { code: 17, status: Number.POSITIVE_INFINITY, message: false },
  ])('falls back safely for an unknown failure: %o', (failure) => {
    expect(toAuthErrorMessage(failure)).toBe(MESSAGE.unknown);
  });

  it('falls back when reading provider properties throws', () => {
    const failure = Object.defineProperty({}, 'code', {
      get() {
        throw new Error('hostile provider object');
      },
    });

    expect(toAuthErrorMessage(failure)).toBe(MESSAGE.unknown);
  });
});
