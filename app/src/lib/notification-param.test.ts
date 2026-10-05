import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_PARAM,
  openedNotificationId,
  withNotificationParam,
  withoutNotificationParam,
} from './notification-param';

describe('the opened-Notification parameter (#1012)', () => {
  it('is the name send-push and send-digest use', () => {
    expect(NOTIFICATION_PARAM).toBe('notificare');
  });

  it('adds the id beside the link’s own query', () => {
    expect(
      withNotificationParam(
        'https://app.osubb.ro/administrare/grupuri/3?tab=cereri',
        7,
      ),
    ).toBe(
      'https://app.osubb.ro/administrare/grupuri/3?tab=cereri&notificare=7',
    );
    expect(withNotificationParam('https://app.osubb.ro/notificari', 0)).toBe(
      'https://app.osubb.ro/notificari',
    );
  });

  it('reads a positive id and nothing else', () => {
    expect(openedNotificationId('?task=12&notificare=55')).toBe(55);
    expect(openedNotificationId('?task=12')).toBeNull();
    for (const bad of ['abc', '0', '-3', '1.5', '', '99999999999999999'])
      expect(openedNotificationId(`?notificare=${bad}`)).toBeNull();
  });

  it('removes the parameter and keeps the rest', () => {
    expect(withoutNotificationParam('?task=12&notificare=55')).toBe('?task=12');
    expect(withoutNotificationParam('?notificare=55')).toBe('');
  });
});
