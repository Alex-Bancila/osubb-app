type AuthFailureDetails = {
  code: string;
  status: number | null;
  message: string;
};

type AuthFailureKind =
  'expired' | 'invalid' | 'rate-limit' | 'network' | 'unknown';

const MESSAGES: Record<AuthFailureKind, string> = {
  expired: 'Linkul a expirat sau a fost deja folosit. Cere unul nou.',
  invalid: 'Linkul de conectare nu este valid. Cere unul nou.',
  'rate-limit':
    'Prea multe cereri într-un timp scurt. Încearcă din nou peste un minut.',
  network:
    'Nu te-am putut conecta la internet. Verifică conexiunea și încearcă din nou.',
  unknown:
    'Nu am putut finaliza conectarea. Încearcă din nou; dacă problema persistă, anunță BC.',
};

const EXPIRED_CODES = new Set(['otp_expired', 'token_expired']);
const INVALID_CODES = new Set([
  'access_denied',
  'invalid_grant',
  'invalid_link',
  'invalid_token',
  'token_not_found',
]);
const RATE_LIMIT_CODES = new Set([
  'over_email_send_rate_limit',
  'over_request_rate_limit',
  'rate_limit_exceeded',
  'too_many_requests',
]);
const NETWORK_CODES = new Set(['fetch_error', 'network_error', 'offline']);

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function detailsFrom(error: unknown): AuthFailureDetails {
  if (typeof error === 'string') {
    return { code: '', status: null, message: error };
  }

  if (typeof error !== 'object' || error === null) {
    return { code: '', status: null, message: '' };
  }

  const candidate = error as Record<string, unknown>;
  let code: unknown;
  let status: unknown;
  let message: unknown;

  try {
    code = candidate.code;
    status = candidate.status;
    message = candidate.message;
  } catch {
    return { code: '', status: null, message: '' };
  }

  return {
    code: readString(code).toLowerCase(),
    status: readNumber(status),
    message: readString(message),
  };
}

function kindFrom({
  code,
  status,
  message,
}: AuthFailureDetails): AuthFailureKind {
  if (
    EXPIRED_CODES.has(code) ||
    /\b(?:otp|token|link)\b.*\bexpired\b|\bexpired\b.*\b(?:otp|token|link)\b/i.test(
      message,
    )
  ) {
    return 'expired';
  }

  if (
    INVALID_CODES.has(code) ||
    /access denied|invalid (?:token|link|grant)|token.*(?:invalid|not found)|link.*not valid/i.test(
      message,
    )
  ) {
    return 'invalid';
  }

  if (
    RATE_LIMIT_CODES.has(code) ||
    status === 429 ||
    /rate limit|too many (?:requests|emails)/i.test(message)
  ) {
    return 'rate-limit';
  }

  if (
    NETWORK_CODES.has(code) ||
    status === 0 ||
    /failed to fetch|network(?:\s+request)?\s+(?:failed|error)|networkerror|offline|load failed/i.test(
      message,
    )
  ) {
    return 'network';
  }

  return 'unknown';
}

/** Returns a fixed, safe Romanian message for any Supabase Auth failure. */
export function toAuthErrorMessage(error: unknown): string {
  return MESSAGES[kindFrom(detailsFrom(error))];
}
