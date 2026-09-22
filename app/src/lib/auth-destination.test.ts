import { describe, expect, it } from 'vitest';
import {
  authCallbackUrl,
  loginDestination,
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
