/**
 * Pure helpers for the email-change flow (#632). No React, no Supabase —
 * testable alone, just like `role-timeline.ts` for #633.
 */

/**
 * Normalize an email address: trim whitespace and lowercase.
 * This matches what the `sync_profile_email` trigger does on the server,
 * so the form sends the same value Auth will end up storing.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Kinds specific to the email-change flow. */
export type EmailChangeErrorKind =
  | 'email-in-use'
  | 'same-email'
  | 'invalid-email'
  | 'rate-limit'
  | 'unknown';

const EMAIL_IN_USE_CODES = new Set([
  'email_exists',
  'email_conflict_identity_not_deletable',
  'identity_already_exists',
]);

const RATE_LIMIT_CODES = new Set([
  'over_email_send_rate_limit',
  'over_request_rate_limit',
  'rate_limit_exceeded',
  'too_many_requests',
]);

const MESSAGES: Record<EmailChangeErrorKind, string> = {
  'email-in-use':
    'Această adresă de email este deja folosită de un alt cont.',
  'same-email':
    'Noua adresă este identică cu cea actuală.',
  'invalid-email':
    'Adresa de email nu este validă. Verifică formatul și încearcă din nou.',
  'rate-limit':
    'Prea multe cereri într-un timp scurt. Încearcă din nou peste un minut.',
  unknown:
    'Nu am putut trimite cererea. Încearcă din nou; dacă problema persistă, anunță BC.',
};

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function classifyError(error: unknown): EmailChangeErrorKind {
  if (typeof error !== 'object' || error === null) return 'unknown';

  let code: string;
  let status: number | null;
  let message: string;

  try {
    const obj = error as Record<string, unknown>;
    code = readString(obj.code).toLowerCase();
    status = readNumber(obj.status);
    message = readString(obj.message).toLowerCase();
  } catch {
    return 'unknown';
  }

  // Email already in use
  if (
    EMAIL_IN_USE_CODES.has(code) ||
    status === 422 && /already.*registered|already.*exists|email.*use/i.test(message) ||
    /already.*registered|already.*exists|email.*taken|email.*use/i.test(message)
  ) {
    return 'email-in-use';
  }

  // Same email
  if (
    message.includes('same') && message.includes('email') ||
    code === 'same_email'
  ) {
    return 'same-email';
  }

  // Invalid email format
  if (
    code === 'validation_failed' ||
    /invalid.*email|email.*invalid|unable to validate/i.test(message)
  ) {
    return 'invalid-email';
  }

  // Rate limit
  if (
    RATE_LIMIT_CODES.has(code) ||
    status === 429 ||
    /rate limit|too many/i.test(message)
  ) {
    return 'rate-limit';
  }

  return 'unknown';
}

/**
 * Returns a fixed, safe Romanian message for any Supabase Auth email-change
 * failure. Parallel to `toAuthErrorMessage` but specific to the email-change
 * flow and its distinct error set.
 */
export function toEmailChangeError(error: unknown): string {
  return MESSAGES[classifyError(error)];
}
