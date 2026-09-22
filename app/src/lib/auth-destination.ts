/** Only application routes may survive the trip through an email link. */
const memberRoutes = new Set([
  '/',
  '/tracker',
  '/calendar',
  '/cereri',
  '/anunturi',
  '/voluntari',
  '/profil',
  '/bc',
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
