import { describe, expect, it } from 'vitest';
import {
  authCallbackUrl,
  confirmDestination,
  loginDestination,
  loginEmailFrom,
  safeAuthDestination,
} from './auth-destination';

describe('safe authentication destinations', () => {
  it.each([
    null,
    '',
    'https://example.com',
    '//example.com',
    '/\\example.com',
    '/login',
    '/auth/callback',
    '/no-profile',
    '/unknown',
    '/%2f%2fexample.com',
    '/calendar\n',
  ])('rejects %s', (value) => {
    expect(safeAuthDestination(value)).toBe('/');
  });
  it('keeps path, query and fragment through the login and email callback URLs', () => {
    const next = '/cereri?source=test#requests';
    const login = loginDestination(next);
    window.history.replaceState({}, '', login);
    const callback = new URL(authCallbackUrl());
    expect(callback.origin).toBe(window.location.origin);
    expect(callback.pathname).toBe('/auth/callback');
    expect(callback.searchParams.get('next')).toBe(next);
    expect(safeAuthDestination(callback.searchParams.get('next'))).toBe(next);
    window.history.replaceState({}, '', '/');
  });
});

describe('click-to-confirm destinations (#768)', () => {
  const at = (search: string) => {
    window.history.replaceState({}, '', `/auth/confirm${search}`);
    const destination = confirmDestination();
    window.history.replaceState({}, '', '/');
    return destination;
  };

  it('reads next from the redirect_to GoTrue rendered into the link', () => {
    const redirect = encodeURIComponent(
      'http://localhost:5173/auth/callback?next=%2Fcereri%3Fx%3D1',
    );
    expect(at(`?token_hash=h&type=email&redirect_to=${redirect}`)).toBe(
      '/cereri?x=1',
    );
  });

  it('prefers a direct next and falls back to the app root', () => {
    expect(at('?next=%2Fcalendar')).toBe('/calendar');
    expect(at('?token_hash=h&type=invite')).toBe('/');
    expect(at('?redirect_to=not-a-url')).toBe('/');
    expect(at('?redirect_to=http%3A%2F%2Flocalhost%3A5173')).toBe('/');
  });

  it('never lets redirect_to smuggle a non-member route', () => {
    for (const next of ['//evil.example', '/login', 'https://evil.example']) {
      const redirect = encodeURIComponent(
        `https://evil.example/auth/callback?next=${encodeURIComponent(next)}`,
      );
      expect(at(`?redirect_to=${redirect}`)).toBe('/');
    }
  });

  it('reads the handed-over login address only when it is a string', () => {
    expect(loginEmailFrom({ email: 'membru@exemplu.ro' })).toBe(
      'membru@exemplu.ro',
    );
    expect(loginEmailFrom(null)).toBe('');
    expect(loginEmailFrom('membru@exemplu.ro')).toBe('');
    expect(loginEmailFrom({ email: 42 })).toBe('');
  });
});
