import { describe, expect, it, vi } from 'vitest';
import { bytesToUrlBase64, urlBase64ToUint8Array } from '../lib/vapid-key';
import {
  isPushSubscriptionChangedMessage,
  PUSH_SUBSCRIPTION_CHANGED,
  renewSubscription,
} from './push-renewal';

const KEY = bytesToUrlBase64(
  Uint8Array.from([0x04, ...Array.from({ length: 64 }, (_, i) => i)]),
);

function subscription(endpoint: string, key: ArrayBuffer | null = null) {
  return {
    options: { applicationServerKey: key },
    toJSON: (): PushSubscriptionJSON => ({ endpoint, keys: {} }),
  };
}

function fakes() {
  const posted: unknown[] = [];
  const fresh = subscription('https://push.example.test/fresh');
  const pushManager = { subscribe: vi.fn(async () => fresh) };
  const clients = {
    matchAll: vi.fn(async () => [
      { postMessage: (message: unknown) => posted.push(message) },
      { postMessage: (message: unknown) => posted.push(message) },
    ]),
  };
  return { posted, pushManager, clients };
}

describe('renewSubscription (#769)', () => {
  it('subscribes with the build key and tells every window', async () => {
    const { posted, pushManager, clients } = fakes();
    const old = subscription('https://push.example.test/old');

    const message = await renewSubscription(
      pushManager,
      clients,
      { oldSubscription: old, newSubscription: null },
      KEY,
    );

    expect(pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(KEY),
    });
    expect(message).toEqual({
      type: PUSH_SUBSCRIPTION_CHANGED,
      subscription: { endpoint: 'https://push.example.test/fresh', keys: {} },
      oldSubscription: { endpoint: 'https://push.example.test/old', keys: {} },
    });
    expect(posted).toEqual([message, message]);
  });

  it('uses the subscription the browser already made', async () => {
    const { pushManager, clients } = fakes();
    const renewed = subscription('https://push.example.test/renewed');

    const message = await renewSubscription(
      pushManager,
      clients,
      { oldSubscription: null, newSubscription: renewed },
      KEY,
    );

    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(message?.subscription.endpoint).toBe(
      'https://push.example.test/renewed',
    );
    expect(message?.oldSubscription).toBeNull();
  });

  it('falls back to the old key, and gives up without any key', async () => {
    const { pushManager, clients } = fakes();
    const oldKey = urlBase64ToUint8Array(KEY).buffer as ArrayBuffer;

    await renewSubscription(
      pushManager,
      clients,
      {
        oldSubscription: subscription('https://push.example.test/old', oldKey),
        newSubscription: null,
      },
      undefined,
    );
    expect(pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: oldKey,
    });

    expect(
      await renewSubscription(
        pushManager,
        clients,
        { oldSubscription: null, newSubscription: null },
        '',
      ),
    ).toBeNull();
  });

  it('recognises only its own message', () => {
    expect(
      isPushSubscriptionChangedMessage({
        type: PUSH_SUBSCRIPTION_CHANGED,
        subscription: { endpoint: 'https://x.test' },
        oldSubscription: null,
      }),
    ).toBe(true);
    expect(isPushSubscriptionChangedMessage({ type: 'SKIP_WAITING' })).toBe(
      false,
    );
    expect(isPushSubscriptionChangedMessage(null)).toBe(false);
  });
});
