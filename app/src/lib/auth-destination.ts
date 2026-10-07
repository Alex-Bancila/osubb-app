import { matchPath } from 'react-router';
import { sameOriginPath } from './links';

/**
 * Only application routes may survive the trip through an email link, and
 * every one of them does, sub-pages included (#844): a Group, a member's
 * history, an Administrare tab or page. They are React Router patterns, so a
 * route and its allow-list entry read the same. Whether the Member may open
 * the page is still the capability guard's decision after sign-in.
 */
const memberRoutes = [
  '/',
  '/tracker',
  // Task links sent before #843 (`/tracker/<id>`); App.tsx forwards them.
  '/tracker/:taskId',
  '/tracker/membru/:id',
  '/calendar',
  '/grupuri',
  '/grupuri/:groupId',
  // Links to the Cereri page before #973; App.tsx forwards them to Taskuri.
  '/cereri',
  '/anunturi',
  // R45: the OSUBB Deals tab, where "Deal nou" links (`?deal=<id>`).
  '/anunturi/deals',
  // #775: the Email Digest's "Deschide notificările" button survives the login.
  '/notificari',
  '/voluntari',
  '/clasament',
  '/profil',
  '/administrare/*',
] as const;

function isMemberRoute(pathname: string): boolean {
  return memberRoutes.some(
    (pattern) => matchPath({ path: pattern, end: true }, pathname) !== null,
  );
}

/**
 * A `next` or `redirect_to` destination: a same-origin path (the shared rule,
 * `sameOriginPath`) whose route is a member route, otherwise `/`. Resolved
 * against a sentinel origin, so the answer does not depend on where the page
 * runs. Surrounding whitespace is refused outright rather than trimmed.
 */
export function safeAuthDestination(value: string | null): string {
  if (!value || value !== value.trim()) return '/';
  const path = sameOriginPath(value, 'https://app.invalid');
  const { pathname } = new URL(path, 'https://app.invalid');
  return isMemberRoute(pathname) ? path : '/';
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

/**
 * The `redirect_to` an emailed link carries. `next` defaults to where the
 * login screen was sent from; the email change on Profil passes `/profil`
 * (#632), so both confirmation links bring the Member back there.
 */
export function authCallbackUrl(requested?: string): string {
  const url = new URL('/auth/callback', window.location.origin);
  const next =
    requested === undefined
      ? authDestination()
      : safeAuthDestination(requested);
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
