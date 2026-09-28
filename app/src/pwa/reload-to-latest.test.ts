import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { reloadToLatestVersion } from './reload-to-latest';

const reload = vi.fn();
const original = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');

function withServiceWorker(container: unknown) {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: container,
  });
}

beforeEach(() => {
  reload.mockReset();
  vi.stubGlobal('location', { ...window.location, reload });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  if (original) Object.defineProperty(navigator, 'serviceWorker', original);
  else Reflect.deleteProperty(navigator, 'serviceWorker');
});

it('simply reloads when there is no service worker', async () => {
  withServiceWorker(undefined);
  await reloadToLatestVersion();
  expect(reload).toHaveBeenCalledTimes(1);
});

it('reloads when no new build is waiting', async () => {
  const update = vi.fn(async () => {});
  withServiceWorker({
    getRegistration: async () => ({ update, waiting: null, installing: null }),
  });
  await reloadToLatestVersion();
  expect(update).toHaveBeenCalledTimes(1);
  expect(reload).toHaveBeenCalledTimes(1);
});

it('lets a waiting build take over first, then reloads onto it', async () => {
  vi.useFakeTimers();
  let onControllerChange: (() => void) | undefined;
  const postMessage = vi.fn();
  withServiceWorker({
    getRegistration: async () => ({
      update: async () => {},
      waiting: { postMessage },
      installing: null,
    }),
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'controllerchange') onControllerChange = listener;
    },
  });
  await reloadToLatestVersion();
  expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  expect(reload).not.toHaveBeenCalled();
  onControllerChange?.();
  expect(reload).toHaveBeenCalledTimes(1);
});

it('reloads anyway when the waiting build never takes over', async () => {
  vi.useFakeTimers();
  withServiceWorker({
    getRegistration: async () => ({
      update: async () => {},
      waiting: { postMessage: vi.fn() },
      installing: null,
    }),
    addEventListener: vi.fn(),
  });
  await reloadToLatestVersion();
  expect(reload).not.toHaveBeenCalled();
  vi.advanceTimersByTime(5_000);
  expect(reload).toHaveBeenCalledTimes(1);
});

it('reloads all the same when the update check fails', async () => {
  withServiceWorker({
    getRegistration: async () => {
      throw new Error('offline');
    },
  });
  await reloadToLatestVersion();
  expect(reload).toHaveBeenCalledTimes(1);
});
