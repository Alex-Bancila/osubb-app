import { beforeEach, expect, it, vi } from 'vitest';
import {
  forgetSignInRequest,
  rememberSignInRequest,
  requestedSignInFor,
} from './sign-in-request';

const NOW = Date.parse('2026-09-27T10:00:00Z');

beforeEach(() => localStorage.clear());

it('matches the address this browser asked for, in any case', () => {
  rememberSignInRequest(' Membru@Exemplu.ro ', NOW);
  expect(requestedSignInFor('membru@exemplu.ro', NOW + 1000)).toBe(true);
  expect(requestedSignInFor('MEMBRU@exemplu.ro', NOW + 1000)).toBe(true);
  expect(requestedSignInFor('altcineva@exemplu.ro', NOW + 1000)).toBe(false);
});

it('stops matching once a link would have expired, or after it is forgotten', () => {
  rememberSignInRequest('membru@exemplu.ro', NOW);
  expect(requestedSignInFor('membru@exemplu.ro', NOW + 61 * 60 * 1000)).toBe(
    false,
  );
  expect(requestedSignInFor('membru@exemplu.ro', NOW + 1000)).toBe(true);
  forgetSignInRequest();
  expect(requestedSignInFor('membru@exemplu.ro', NOW + 1000)).toBe(false);
});

it('treats a missing, garbled or unreadable record as no request', () => {
  expect(requestedSignInFor('membru@exemplu.ro')).toBe(false);
  localStorage.setItem('osubb.sign-in-request', '{not json');
  expect(requestedSignInFor('membru@exemplu.ro')).toBe(false);
  localStorage.setItem('osubb.sign-in-request', '"membru@exemplu.ro"');
  expect(requestedSignInFor('membru@exemplu.ro')).toBe(false);

  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(requestedSignInFor('membru@exemplu.ro')).toBe(false);
});
