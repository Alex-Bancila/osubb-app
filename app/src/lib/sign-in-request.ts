/**
 * The address this browser asked a sign-in link for (security audit F3).
 *
 * `/auth/confirm` cannot trust the `email=` in a link — anyone can write any
 * address there, or none — so it compares the account a link signed in with
 * the address the login screen on *this* browser asked for. A match signs in
 * without a second question; anything else (an invitation, a link opened on
 * another device, a link someone else sent) first shows the verified address
 * and asks the Member to confirm it is theirs.
 *
 * Only an address and a time are kept, for as long as a link lives, and every
 * storage access is guarded: private windows and blocked storage just mean the
 * Member is asked.
 */
const KEY = 'osubb.sign-in-request';

/** GoTrue's default OTP lifetime: a link older than this is dead anyway. */
const LIFETIME_MS = 60 * 60 * 1000;

const normalize = (email: string) => email.trim().toLowerCase();

export function rememberSignInRequest(email: string, now = Date.now()) {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ email: normalize(email), at: now }),
    );
  } catch {
    // No storage: the confirm page will ask instead.
  }
}

export function forgetSignInRequest() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}

/** Whether this browser asked, within a link's lifetime, for `email`. */
export function requestedSignInFor(email: string, now = Date.now()): boolean {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (typeof value !== 'object' || value === null) return false;
    const { email: requested, at } = value as Record<string, unknown>;
    return (
      typeof requested === 'string' &&
      typeof at === 'number' &&
      now - at >= 0 &&
      now - at < LIFETIME_MS &&
      requested === normalize(email)
    );
  } catch {
    return false;
  }
}
