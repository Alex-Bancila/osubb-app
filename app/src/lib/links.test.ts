import { describe, expect, it } from 'vitest';
import { inAppPath, safeHttpUrl, sameOriginPath } from './links';

const ORIGIN = 'https://app.osubb.ro';

describe('sameOriginPath', () => {
  it.each([
    ['/tracker/12', '/tracker/12'],
    ['/calendar?event=3', '/calendar?event=3'],
    ['/administrare/grupuri/3#roster', '/administrare/grupuri/3#roster'],
    ['  /grupuri/3  ', '/grupuri/3'],
  ])('keeps the in-app path %j', (value, expected) => {
    expect(sameOriginPath(value, ORIGIN)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    '',
    '   ',
    'tracker/12',
    'https://evil.example/phish',
    'HTTPS://evil.example',
    '//evil.example/phish',
    '/\\evil.example/phish',
    '\\\\evil.example',
    '/\t/evil.example/phish',
    '/\n/evil.example/phish',
    '/\r/evil.example',
    '/calendar\u007f',
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
  ])('sends %j to the app root', (value) => {
    expect(sameOriginPath(value, ORIGIN)).toBe('/');
    expect(inAppPath(value, ORIGIN)).toBeNull();
  });

  it('resolves against the page origin by default', () => {
    expect(sameOriginPath('/profil')).toBe('/profil');
    expect(sameOriginPath('/\t/evil.example')).toBe('/');
  });
});

describe('safeHttpUrl', () => {
  it.each([
    'https://forms.example/a?b=1',
    'http://forms.example',
    'HTTPS://forms.example/x',
  ])('keeps %j', (value) => {
    expect(safeHttpUrl(value)).toBe(value);
  });

  it.each([
    ' https://forms.example',
    'https://forms.example ',
    null,
    undefined,
    '',
    'javascript:alert(1)',
    ' javascript:alert(1)',
    'data:text/html,hi',
    'forms.example',
    '/relative',
    '//forms.example',
    'https://',
    'https://forms.example/a b',
    'https://forms.\texample',
    'ftp://forms.example',
  ])('refuses %j', (value) => {
    expect(safeHttpUrl(value)).toBeNull();
  });
});
