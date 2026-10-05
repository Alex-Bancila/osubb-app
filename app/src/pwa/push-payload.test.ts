import { describe, expect, it, vi } from 'vitest';
import {
  focusOrOpen,
  openTappedNotification,
  parsePushPayload,
  tapUrl,
  targetUrl,
} from './push-payload';

const ORIGIN = 'https://app.osubb.ro';

describe('parsePushPayload', () => {
  it('reads the four fields send-push sends (#703)', () => {
    expect(
      parsePushPayload(
        JSON.stringify({
          id: 42,
          title: 'Task nou',
          body: 'Ai primit „Afiș”.',
          link: '/tracker/12',
        }),
      ),
    ).toEqual({
      id: 42,
      title: 'Task nou',
      body: 'Ai primit „Afiș”.',
      link: '/tracker/12',
    });
  });

  it('ignores the Declarative Web Push keys and any other top-level key (#778)', () => {
    expect(
      parsePushPayload(
        JSON.stringify({
          id: 42,
          title: 'Task nou',
          body: 'Ai primit „Afiș”.',
          link: '/tracker/12',
          web_push: 8030,
          notification: {
            title: 'Task nou',
            body: 'Ai primit „Afiș”.',
            navigate: 'https://app.osubb.ro/tracker/12',
            tag: 'osubb-42',
            lang: 'ro',
          },
          future_key: { anything: true },
        }),
      ),
    ).toEqual({
      id: 42,
      title: 'Task nou',
      body: 'Ai primit „Afiș”.',
      link: '/tracker/12',
    });
  });

  it('accepts a Notification without a body or a link', () => {
    expect(
      parsePushPayload(
        JSON.stringify({ id: 7, title: 'Ședință', body: null, link: null }),
      ),
    ).toEqual({ id: 7, title: 'Ședință', body: null, link: null });
    expect(
      parsePushPayload(JSON.stringify({ id: 7, title: 'Ședință' })),
    ).toEqual({ id: 7, title: 'Ședință', body: null, link: null });
  });

  it.each([
    ['no data', null],
    ['an empty push', ''],
    ['text that is not JSON', 'hello'],
    ['a JSON scalar', '42'],
    ['JSON null', 'null'],
    ['a missing id', JSON.stringify({ title: 'x' })],
    ['a string id', JSON.stringify({ id: '1', title: 'x' })],
    ['a fractional id', JSON.stringify({ id: 1.5, title: 'x' })],
    ['a missing title', JSON.stringify({ id: 1 })],
    ['a blank title', JSON.stringify({ id: 1, title: '  ' })],
    ['a body that is not text', JSON.stringify({ id: 1, title: 'x', body: 3 })],
    [
      'a link that is not text',
      JSON.stringify({ id: 1, title: 'x', link: {} }),
    ],
  ])('drops %s', (_label, text) => {
    expect(parsePushPayload(text)).toBeNull();
  });
});

describe('targetUrl', () => {
  it('opens the in-app route the Notification links to', () => {
    expect(targetUrl('/tracker/12', ORIGIN)).toBe(
      'https://app.osubb.ro/tracker/12',
    );
    expect(targetUrl('/calendar?event=3', ORIGIN)).toBe(
      'https://app.osubb.ro/calendar?event=3',
    );
  });

  it('opens the notification list without a usable link', () => {
    for (const link of [
      null,
      undefined,
      '',
      '   ',
      'https://evil.test/phish',
      '//evil.test/phish',
      'tracker/12',
    ]) {
      expect(targetUrl(link, ORIGIN)).toBe('https://app.osubb.ro/notificari');
    }
  });
});

describe('targetUrl near misses', () => {
  it('never leaves the app for a path the URL parser reads as another host', () => {
    for (const link of [String.raw`/\evil.test/phish`, '/\t/evil.test/phish'])
      expect(targetUrl(link, ORIGIN)).toBe('https://app.osubb.ro/notificari');
  });
});

describe('focusOrOpen', () => {
  function windowClient(url: string) {
    const client = {
      url,
      focus: vi.fn(async () => client),
      navigate: vi.fn(async () => client),
    };
    return client;
  }

  it('focuses an open app window and takes it to the link', async () => {
    const other = windowClient('https://elsewhere.test/');
    const app = windowClient('https://app.osubb.ro/calendar');
    const clients = {
      matchAll: vi.fn(async () => [other, app]),
      openWindow: vi.fn(async () => null),
    };

    await focusOrOpen(clients, 'https://app.osubb.ro/tracker/12', ORIGIN);

    expect(clients.matchAll).toHaveBeenCalledWith({
      type: 'window',
      includeUncontrolled: true,
    });
    expect(app.focus).toHaveBeenCalled();
    expect(app.navigate).toHaveBeenCalledWith(
      'https://app.osubb.ro/tracker/12',
    );
    expect(other.focus).not.toHaveBeenCalled();
    expect(clients.openWindow).not.toHaveBeenCalled();
  });

  it('opens a new window when the app is not open', async () => {
    const clients = {
      matchAll: vi.fn(async () => []),
      openWindow: vi.fn(async () => null),
    };

    await focusOrOpen(clients, 'https://app.osubb.ro/notificari', ORIGIN);

    expect(clients.openWindow).toHaveBeenCalledWith(
      'https://app.osubb.ro/notificari',
    );
  });

  it('opens a new window when the open one cannot be navigated', async () => {
    const app = windowClient('https://app.osubb.ro/');
    app.navigate.mockRejectedValueOnce(new TypeError('not controlled'));
    const clients = {
      matchAll: vi.fn(async () => [app]),
      openWindow: vi.fn(async () => null),
    };

    await focusOrOpen(clients, 'https://app.osubb.ro/tracker/12', ORIGIN);

    expect(clients.openWindow).toHaveBeenCalledWith(
      'https://app.osubb.ro/tracker/12',
    );
  });
});

describe('a tap reads its Notification (#1012, R37)', () => {
  it('opens the target with the Notification id beside the link’s own query', () => {
    expect(tapUrl('/calendar?event=3', 42, ORIGIN)).toBe(
      'https://app.osubb.ro/calendar?event=3&notificare=42',
    );
    expect(tapUrl(null, 42, ORIGIN)).toBe(
      'https://app.osubb.ro/notificari?notificare=42',
    );
  });

  it('opens the bare target for a payload without a usable id', () => {
    expect(tapUrl('/tracker?task=12', undefined, ORIGIN)).toBe(
      'https://app.osubb.ro/tracker?task=12',
    );
    expect(tapUrl('/tracker?task=12', '42', ORIGIN)).toBe(
      'https://app.osubb.ro/tracker?task=12',
    );
  });

  it('the click handler closes the notification and opens the target with its id', async () => {
    const close = vi.fn();
    const clients = {
      matchAll: vi.fn().mockResolvedValue([]),
      openWindow: vi.fn().mockResolvedValue(null),
    };

    await openTappedNotification(
      { close, data: { link: '/anunturi?anunt=8', id: 77 } },
      clients,
      ORIGIN,
    );

    expect(close).toHaveBeenCalledTimes(1);
    expect(clients.openWindow).toHaveBeenCalledWith(
      'https://app.osubb.ro/anunturi?anunt=8&notificare=77',
    );
  });

  it('the click handler takes an open app window to the target instead', async () => {
    const focused = { url: ORIGIN, focus: vi.fn(), navigate: vi.fn() };
    focused.focus.mockResolvedValue(focused);
    focused.navigate.mockResolvedValue(focused);
    const clients = {
      matchAll: vi.fn().mockResolvedValue([focused]),
      openWindow: vi.fn(),
    };

    await openTappedNotification(
      { close: vi.fn(), data: { link: null, id: 5 } },
      clients,
      ORIGIN,
    );

    expect(focused.navigate).toHaveBeenCalledWith(
      'https://app.osubb.ro/notificari?notificare=5',
    );
    expect(clients.openWindow).not.toHaveBeenCalled();
  });
});
