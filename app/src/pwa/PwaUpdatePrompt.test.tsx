import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PwaUpdatePrompt } from './PwaUpdatePrompt';

const registration = vi.hoisted(() => ({
  needRefresh: true,
  setNeedRefresh: vi.fn(),
  updateServiceWorker: vi.fn<() => Promise<void>>(),
  /** What the prompt asked `useRegisterSW` for. */
  options: undefined as
    | {
        onRegisteredSW?: (
          url: string,
          registration: ServiceWorkerRegistration | undefined,
        ) => void;
      }
    | undefined,
}));

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: (options: typeof registration.options) => {
    registration.options = options;
    return {
      needRefresh: [registration.needRefresh, registration.setNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: registration.updateServiceWorker,
    };
  },
}));

const reload = vi.fn();
const originalServiceWorker = Object.getOwnPropertyDescriptor(
  navigator,
  'serviceWorker',
);

/** The browser's service worker container, as the page sees it. */
function withServiceWorker(container: unknown) {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: container,
  });
}

describe('PwaUpdatePrompt', () => {
  beforeEach(() => {
    registration.needRefresh = true;
    reload.mockReset();
    vi.stubGlobal('location', { ...window.location, reload });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    if (originalServiceWorker)
      Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker);
    else Reflect.deleteProperty(navigator, 'serviceWorker');
  });

  it('asks before the new build takes over, and can wait', async () => {
    const user = userEvent.setup();
    render(<PwaUpdatePrompt />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'O versiune nouă a aplicației este disponibilă.',
    );
    await user.click(screen.getByRole('button', { name: 'Mai târziu' }));
    expect(registration.setNeedRefresh).toHaveBeenCalledWith(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('stays out of the page when no update is waiting', () => {
    registration.needRefresh = false;
    render(<PwaUpdatePrompt />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // The phone bug: a page opened before any worker existed (an installed
  // app's first launch) is never controlled, so a new build found while it
  // stays open waits for nobody and is already active. Nothing waits for
  // SKIP_WAITING and no controller ever changes. Fails if the tap only
  // messages a waiting worker: the prompt stays and nothing happens.
  it('reloads onto the new build when it has already taken over (nothing waits)', async () => {
    const user = userEvent.setup();
    withServiceWorker({
      controller: null,
      getRegistration: async () => ({
        update: async () => {},
        waiting: null,
        installing: null,
      }),
    });
    render(<PwaUpdatePrompt />);

    await user.click(
      screen.getByRole('button', { name: 'Actualizează aplicația' }),
    );

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it('hands over to a waiting build, then reloads once it takes control', async () => {
    // The handover arms a 5 s fallback reload; fake timers drop it when the
    // test ends, while still moving with real time for the clicks.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
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
    render(<PwaUpdatePrompt />);

    await user.click(
      screen.getByRole('button', { name: 'Actualizează aplicația' }),
    );
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' }),
    );
    expect(reload).not.toHaveBeenCalled();
    act(() => onControllerChange?.());
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // Fails if the button looks the same while the handover waits on a slow
  // network: the Member taps again, sees nothing, and calls it broken.
  it('shows that it is updating while the handover runs', async () => {
    const user = userEvent.setup();
    withServiceWorker({
      getRegistration: async () => ({
        update: () => new Promise<void>(() => {}),
        waiting: null,
        installing: null,
      }),
    });
    render(<PwaUpdatePrompt />);

    await user.click(
      screen.getByRole('button', { name: 'Actualizează aplicația' }),
    );

    expect(
      await screen.findByRole('button', { name: 'Se actualizează…' }),
    ).toBeDisabled();
    expect(reload).not.toHaveBeenCalled();
  });
});

/*
 * #1137: an installed app that stays open, or comes back to the
 * foreground, looks for a new build — on return to the app at most once
 * every ten minutes, and every hour while it stays open. A new build found
 * shows the prompt above; nothing reloads without the Member's tap.
 */
describe('looking for a new build (#1137)', () => {
  const MINUTE = 60_000;
  let visibility: DocumentVisibilityState = 'visible';

  /** The page goes to the background or comes back to the foreground. */
  function becomes(state: DocumentVisibilityState) {
    visibility = state;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
  }

  /** The prompt mounted and its worker registered, as on a cold start. */
  function registered() {
    const worker = {
      update: vi.fn<() => Promise<void>>().mockResolvedValue(),
    };
    const view = render(<PwaUpdatePrompt />);
    act(() =>
      registration.options?.onRegisteredSW?.(
        '/sw.js',
        worker as unknown as ServiceWorkerRegistration,
      ),
    );
    return { worker, ...view };
  }

  beforeEach(() => {
    registration.needRefresh = false;
    vi.useFakeTimers();
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(
      () => visibility,
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // Fails without an update check on return: a phone that kept the app
  // open since yesterday keeps yesterday's build and RPC contract.
  it('looks once for a new build when the app comes back after ten minutes', () => {
    const { worker } = registered();

    becomes('hidden');
    act(() => vi.advanceTimersByTime(11 * MINUTE));
    becomes('visible');

    expect(worker.update).toHaveBeenCalledOnce();
  });

  // Fails if every return looks: a Member switching apps would ask the
  // server for the worker each time.
  it('looks at most once in ten minutes, however often the app comes back', () => {
    const { worker } = registered();

    act(() => vi.advanceTimersByTime(11 * MINUTE));
    becomes('hidden');
    becomes('visible');
    act(() => vi.advanceTimersByTime(MINUTE));
    becomes('hidden');
    becomes('visible');

    expect(worker.update).toHaveBeenCalledOnce();
  });

  it('does not look again on a return soon after the start, which just looked', () => {
    const { worker } = registered();

    act(() => vi.advanceTimersByTime(2 * MINUTE));
    becomes('hidden');
    becomes('visible');

    expect(worker.update).not.toHaveBeenCalled();
  });

  // Fails without the hourly check: an app that stays on screen all day
  // never hears of a Release.
  it('looks every hour while the app stays open', () => {
    const { worker } = registered();

    act(() => vi.advanceTimersByTime(60 * MINUTE));
    expect(worker.update).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(60 * MINUTE));
    expect(worker.update).toHaveBeenCalledTimes(2);
  });

  it('does not look while the app is in the background', () => {
    const { worker } = registered();
    becomes('hidden');

    act(() => vi.advanceTimersByTime(60 * MINUTE));

    expect(worker.update).not.toHaveBeenCalled();
  });

  it('keeps going when a look fails (offline)', async () => {
    const { worker } = registered();
    worker.update.mockRejectedValueOnce(new Error('offline'));

    await act(() => vi.advanceTimersByTimeAsync(60 * MINUTE));
    await act(() => vi.advanceTimersByTimeAsync(60 * MINUTE));

    expect(worker.update).toHaveBeenCalledTimes(2);
  });

  // Registration resolves later than the first render: one that lands
  // after the prompt is gone must start nothing nobody would stop.
  it('starts nothing when the worker registers after the prompt is gone', () => {
    const worker = {
      update: vi.fn<() => Promise<void>>().mockResolvedValue(),
    };
    const { unmount } = render(<PwaUpdatePrompt />);
    unmount();
    act(() =>
      registration.options?.onRegisteredSW?.(
        '/sw.js',
        worker as unknown as ServiceWorkerRegistration,
      ),
    );

    act(() => vi.advanceTimersByTime(3 * 60 * MINUTE));

    expect(worker.update).not.toHaveBeenCalled();
  });

  it('stops looking once the prompt is gone', () => {
    const { worker, unmount } = registered();
    unmount();

    act(() => vi.advanceTimersByTime(3 * 60 * MINUTE));
    becomes('hidden');
    becomes('visible');

    expect(worker.update).not.toHaveBeenCalled();
  });
});
