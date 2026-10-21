import { describe, expect, it } from 'vitest';
import {
  inAppPath,
  safeHttpUrl,
  sameOriginPath,
  textLinkTarget,
} from './links';

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

describe('textLinkTarget (ruling R60)', () => {
  it('opens an address on the page origin inside the app', () => {
    expect(textLinkTarget(location.origin + '/calendar?event=1')).toEqual({
      kind: 'app',
      path: '/calendar?event=1',
    });
  });

  it.each([
    ['https://app.osubb.ro/tracker/12#istoric', '/tracker/12#istoric'],
    ['HTTPS://APP.OSUBB.RO/anunturi', '/anunturi'],
    ['https://app.osubb.ro', '/'],
  ])('reads %j as the app path %j', (href, path) => {
    expect(textLinkTarget(href, ORIGIN)).toEqual({ kind: 'app', path });
  });

  it.each([
    'https://forms.gle/x',
    'http://app.osubb.ro/tracker',
    'https://osubb.ro/despre',
  ])('opens %j outside the app', (href) => {
    expect(textLinkTarget(href, ORIGIN)).toEqual({ kind: 'external', href });
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,hi',
    'mailto:it@osubb.ro',
    'osubb.ro',
    '/calendar',
    '//evil.example',
    'https://forms.gle/a b',
    '',
  ])('gives no link for %j', (href) => {
    expect(textLinkTarget(href, ORIGIN)).toBeNull();
  });

  it('refuses javascript: against the page origin too', () => {
    expect(textLinkTarget('javascript:alert(1)')).toBeNull();
  });
});
