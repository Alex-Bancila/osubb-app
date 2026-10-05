import { describe, expect, it } from 'vitest';

import type { NotificationRow } from '../../queries/notifications';
import {
  formatNotificationAge,
  formatNotificationMoment,
  inAppLink,
  isGroupNotification,
  markedAllReceipt,
  notificationKindMeta,
  toNotificationPresentation,
  unreadBadgeLabel,
  type NotificationKind,
} from './notifications-presentation';

const MEMBER = '11111111-1111-4111-8111-111111111111';

function notificationRow(
  overrides: Partial<NotificationRow> = {},
): NotificationRow {
  return {
    id: 7,
    member_id: MEMBER,
    kind: 'task',
    icon: null,
    title: 'Task nou: Afiș pentru AGO',
    body: 'Ai fost desemnat executor.',
    critical: false,
    read: false,
    link: '/tracker/12',
    created_at: '2026-09-20T09:00:00.000Z',
    dedupe_key: null,
    digested_at: null,
    subject: null,
    task_id: 12,
    ...overrides,
  };
}

describe('notification presentation', () => {
  it('gives every notification kind its own icon and Romanian word', () => {
    const kinds: NotificationKind[] = [
      'announce',
      'deadline',
      'event',
      'task',
      'system',
    ];
    const labels = kinds.map((kind) => notificationKindMeta(kind).label);
    const icons = kinds.map((kind) => notificationKindMeta(kind).icon);

    expect(labels).toEqual([
      'Anunț',
      'Termen limită',
      'Eveniment',
      'Task',
      'Sistem',
    ]);
    expect(new Set(icons).size).toBe(kinds.length);
  });

  it('reads the moment in Bucharest wall time, whatever the device clock says', () => {
    // 09:00 UTC is 12:00 in Romania during summer time.
    expect(formatNotificationMoment('2026-09-20T09:00:00.000Z')).toBe(
      '20 septembrie 2026, 12:00',
    );
    expect(formatNotificationMoment('not-a-date')).toBe('—');
  });

  it('says how long ago it happened, in Romanian', () => {
    const now = new Date('2026-09-20T12:00:00.000Z');

    expect(formatNotificationAge('2026-09-20T11:45:00.000Z', now)).toBe(
      '15 minute în urmă',
    );
    expect(formatNotificationAge('2026-09-19T12:00:00.000Z', now)).toBe(
      '1 zi în urmă',
    );
    expect(formatNotificationAge('not-a-date', now)).toBe('—');
  });

  it('keeps every link the app writes today, and refuses to leave the app', () => {
    expect(inAppLink('/tracker/12')).toBe('/tracker/12');
    expect(inAppLink('/grupuri/3')).toBe('/grupuri/3');
    expect(inAppLink('/administrare/grupuri/3')).toBe(
      '/administrare/grupuri/3',
    );
    expect(inAppLink('/calendar')).toBe('/calendar');

    expect(inAppLink(null)).toBeNull();
    expect(inAppLink('')).toBeNull();
    expect(inAppLink('https://example.com')).toBeNull();
    expect(inAppLink('//example.com')).toBeNull();
    expect(inAppLink('javascript:alert(1)')).toBeNull();
    // The URL parser strips a tab or new line and reads a backslash as a
    // slash, so these would resolve to another host (security audit F5).
    expect(inAppLink('/\t/evil.example')).toBeNull();
    expect(inAppLink('/\n/evil.example')).toBeNull();
    expect(inAppLink('/\\evil.example')).toBeNull();
    expect(inAppLink('data:text/html,hi')).toBeNull();
  });

  it('maps a row into the model the screen renders', () => {
    const now = new Date('2026-09-20T12:00:00.000Z');
    const presentation = toNotificationPresentation(
      notificationRow({ critical: true, read: true }),
      now,
    );

    expect(presentation).toMatchObject({
      id: 7,
      kind: 'task',
      kindLabel: 'Task',
      title: 'Task nou: Afiș pentru AGO',
      body: 'Ai fost desemnat executor.',
      critical: true,
      isRead: true,
      link: '/tracker/12',
      createdAt: '2026-09-20T09:00:00.000Z',
      ageLabel: 'circa 3 ore în urmă',
      momentLabel: '20 septembrie 2026, 12:00',
    });
  });

  it('drops a link that would take a member out of the app, keeping the row', () => {
    const presentation = toNotificationPresentation(
      notificationRow({ link: 'https://example.com/phishing' }),
    );

    expect(presentation.link).toBeNull();
    expect(presentation.title).toBe('Task nou: Afiș pentru AGO');
  });

  it('counts unread notifications in words for screen readers', () => {
    expect(unreadBadgeLabel(1)).toBe('1 notificare necitită');
    expect(unreadBadgeLabel(4)).toBe('4 notificări necitite');
  });

  describe('Group notifications read "Grupuri", not "Sistem" (#858, B37)', () => {
    it.each([
      ['Ai fost adăugat în Echipa Logistică', '/grupuri/4'],
      ['Numire în Educațional', '/grupuri/2'],
      ['Numire încheiată în Educațional', null],
      ['Nu mai faci parte din Echipa Logistică', null],
      ['Nivel minim actualizat: Educațional', '/administrare/grupuri/2'],
      [
        'Cerere de înscriere: Echipa Logistică',
        '/administrare/grupuri/4?tab=cereri',
      ],
      ['Cerere acceptată: Echipa Logistică', '/grupuri/4'],
      ['Cerere respinsă: Echipa Logistică', null],
    ])('%s', (title, link) => {
      const presentation = toNotificationPresentation(
        notificationRow({ kind: 'system', title, link, task_id: null }),
      );

      expect(presentation.kindLabel).toBe('Grupuri');
    });

    it('keeps "Sistem" for the other system notifications', () => {
      for (const [title, link] of [
        ['Rol actualizat', '/profil'],
        ['Problemă la livrarea emailului', '/administrare/membri/9'],
      ] as const) {
        expect(
          toNotificationPresentation(
            notificationRow({ kind: 'system', title, link, task_id: null }),
          ).kindLabel,
        ).toBe('Sistem');
      }
    });

    it('never relabels another kind, even with a Group link', () => {
      expect(
        isGroupNotification({
          kind: 'announce',
          title: 'Cerere respinsă: Echipa Logistică',
          link: '/grupuri/4',
        }),
      ).toBe(false);
    });
  });
});

describe('markedAllReceipt (#1012)', () => {
  it('counts in Romanian, with "de" from twenty', () => {
    expect(markedAllReceipt(1)).toBe('Am marcat o notificare ca citită.');
    expect(markedAllReceipt(3)).toBe('Am marcat 3 notificări ca citite.');
    expect(markedAllReceipt(19)).toBe('Am marcat 19 notificări ca citite.');
    expect(markedAllReceipt(20)).toBe('Am marcat 20 de notificări ca citite.');
    expect(markedAllReceipt(101)).toBe('Am marcat 101 notificări ca citite.');
  });
});
