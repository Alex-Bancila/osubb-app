import { describe, expect, it } from 'vitest';
import { normalizeEmail, toEmailChangeError } from './email-change';

// ---------------------------------------------------------------------------
// normalizeEmail
// ---------------------------------------------------------------------------

describe('normalizeEmail', () => {
  it('lowercases the address', () => {
    expect(normalizeEmail('ANA@OSUBB.RO')).toBe('ana@osubb.ro');
  });

  it('trims whitespace', () => {
    expect(normalizeEmail('  ana@osubb.ro  ')).toBe('ana@osubb.ro');
  });

  it('lowercases and trims together', () => {
    expect(normalizeEmail('  ANA@Osubb.Ro  ')).toBe('ana@osubb.ro');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeEmail('')).toBe('');
  });

  it('handles a normal address unchanged', () => {
    expect(normalizeEmail('maria@osubb.ro')).toBe('maria@osubb.ro');
  });
});

// ---------------------------------------------------------------------------
// toEmailChangeError
// ---------------------------------------------------------------------------

const MESSAGE = {
  emailInUse: 'Această adresă de email este deja folosită de un alt cont.',
  sameEmail: 'Noua adresă este identică cu cea actuală.',
  invalidEmail:
    'Adresa de email nu este validă. Verifică formatul și încearcă din nou.',
  rateLimit:
    'Prea multe cereri într-un timp scurt. Încearcă din nou peste un minut.',
  unknown:
    'Nu am putut trimite cererea. Încearcă din nou; dacă problema persistă, anunță BC.',
} as const;

describe('toEmailChangeError', () => {
  it.each([
    [{ code: 'email_exists' }, MESSAGE.emailInUse],
    [{ code: 'email_conflict_identity_not_deletable' }, MESSAGE.emailInUse],
    [{ code: 'identity_already_exists' }, MESSAGE.emailInUse],
    [{ status: 422, message: 'User already registered' }, MESSAGE.emailInUse],
    [{ message: 'A user with this email address has already been registered' }, MESSAGE.emailInUse],
    [{ message: 'Email address already in use' }, MESSAGE.emailInUse],
  ])('classifies email-in-use from %o', (failure, expected) => {
    expect(toEmailChangeError(failure)).toBe(expected);
  });

  it.each([
    [{ message: 'A user with this email address has already been registered and the same email' }, MESSAGE.emailInUse],
  ])('email-in-use takes precedence over same-email substring in mixed messages from %o', (failure, expected) => {
    expect(toEmailChangeError(failure)).toBe(expected);
  });

  it.each([
    [{ code: 'same_email' }, MESSAGE.sameEmail],
    [{ message: 'New email is the same as your current email' }, MESSAGE.sameEmail],
  ])('classifies same-email from %o', (failure, expected) => {
    expect(toEmailChangeError(failure)).toBe(expected);
  });

  it.each([
    [{ code: 'validation_failed' }, MESSAGE.invalidEmail],
    [{ message: 'Unable to validate email address: invalid format' }, MESSAGE.invalidEmail],
    [{ message: 'Invalid email format' }, MESSAGE.invalidEmail],
  ])('classifies invalid-email from %o', (failure, expected) => {
    expect(toEmailChangeError(failure)).toBe(expected);
  });

  it.each([
    [{ code: 'over_email_send_rate_limit' }, MESSAGE.rateLimit],
    [{ code: 'too_many_requests' }, MESSAGE.rateLimit],
    [{ status: 429 }, MESSAGE.rateLimit],
    [{ message: 'Rate limit exceeded' }, MESSAGE.rateLimit],
  ])('classifies rate-limit from %o', (failure, expected) => {
    expect(toEmailChangeError(failure)).toBe(expected);
  });

  it.each([
    undefined,
    null,
    42,
    'some string error',
    { code: 'unexpected_error', message: 'something else' },
  ])('falls back safely for an unknown failure: %o', (failure) => {
    expect(toEmailChangeError(failure)).toBe(MESSAGE.unknown);
  });
});
