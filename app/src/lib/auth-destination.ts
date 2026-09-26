/** Only application routes may survive the trip through an email link. */
const memberRoutes = new Set([
  '/',
  '/tracker',
  '/calendar',
  '/cereri',
  '/anunturi',
  '/voluntari',
  '/profil',
  '/administrare',
]);

export function safeAuthDestination(value: string | null): string {
  if (
    !value ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    [...value].some((character) => character.charCodeAt(0) <= 32)
  )
    return '/';
  try {
    const url = new URL(value, 'https://app.invalid');
    if (url.origin !== 'https://app.invalid' || !memberRoutes.has(url.pathname))
      return '/';
    return url.pathname + url.search + url.hash;
  } catch {
    return '/';
  }
}

export function authDestination(): string {
  return safeAuthDestination(
    new URLSearchParams(window.location.search).get('next'),
  );
}

export function loginDestination(value: string): string {
  const next = safeAuthDestination(value);
  return next === '/' ? '/login' : `/login?${new URLSearchParams({ next })}`;
}

export function authCallbackUrl(): string {
  const url = new URL('/auth/callback', window.location.origin);
  const next = authDestination();
  if (next !== '/') url.searchParams.set('next', next);
  return url.href;
}

/**
 * Where `/auth/confirm` sends a Member once the link is used. The emailed link
 * carries GoTrue's `redirect_to` — the callback URL the login screen asked for,
 * `next` included — so the destination is the `next` inside it. Only a member
 * route survives, exactly as on `/auth/callback`.
 */
export function confirmDestination(): string {
  const params = new URLSearchParams(window.location.search);
  const next = params.get('next');
  if (next) return safeAuthDestination(next);

  const redirect = params.get('redirect_to');
  if (!redirect) return '/';
  try {
    return safeAuthDestination(new URL(redirect).searchParams.get('next'));
  } catch {
    return '/';
  }
}

/**
 * The address handed from `/auth/confirm` to the login screen travels in
 * router state, not the URL: a retry should not write the address into
 * browser history or an access log a second time.
 */
export type LoginHandoff = { email: string };

export function loginEmailFrom(state: unknown): string {
  if (typeof state !== 'object' || state === null) return '';
  const email = (state as Record<string, unknown>).email;
  return typeof email === 'string' ? email : '';
}
