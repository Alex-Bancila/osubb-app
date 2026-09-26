import { describe, expect, it } from 'vitest';
import {
  emailChangeReason,
  toAuthErrorMessage,
  toEmailChangeErrorMessage,
} from './auth-error-message';

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

describe('emailChangeReason (#632)', () => {
  it.each([
    // What the local GoTrue answers `PUT /user` for another account's address.
    [
      {
        code: 'email_exists',
        status: 422,
        message: 'A user with this email address has already been registered',
      },
      'email_taken',
    ],
    [{ message: 'User already registered' }, 'email_taken'],
    [{ message: 'Email address already in use' }, 'email_taken'],
    // …and for `ana@`.
    [
      {
        code: 'validation_failed',
        status: 400,
        message: 'Unable to validate email address: invalid format',
      },
      'email_invalid',
    ],
    [{ code: 'email_address_invalid' }, 'email_invalid'],
    [{ message: 'Email address "x@y" is invalid' }, 'email_invalid'],
  ])('reads %o as %s', (failure, reason) => {
    expect(emailChangeReason(failure)).toBe(reason);
  });

  it.each([
    { code: 'over_email_send_rate_limit', status: 429 },
    { message: 'Email rate limit exceeded' },
    { message: 'Unable to use this email provider right now' },
    { message: 'Failed to fetch' },
    null,
    'some string error',
  ])('does not blame the address for %o', (failure) => {
    expect(emailChangeReason(failure)).toBeUndefined();
  });
});

describe('toEmailChangeErrorMessage (#632)', () => {
  it.each([
    [{ code: 'over_email_send_rate_limit', status: 429 }, MESSAGE.rateLimit],
    [{ message: 'Failed to fetch' }, MESSAGE.network],
    [
      { code: 'unexpected_failure', message: 'Error sending email' },
      'Nu am putut trimite cererea. Încearcă din nou; dacă problema persistă, anunță BC.',
    ],
    [
      { code: 'otp_expired' },
      'Nu am putut trimite cererea. Încearcă din nou; dacă problema persistă, anunță BC.',
    ],
  ])('gives %o a safe message', (failure, expected) => {
    expect(toEmailChangeErrorMessage(failure)).toBe(expected);
  });
});
