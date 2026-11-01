import { act, render, screen } from '@testing-library/react';
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

describe('PwaUpdatePrompt', () => {
  beforeEach(() => {
    registration.needRefresh = true;
    registration.updateServiceWorker.mockResolvedValue();
  });

  it('asks before activating a waiting service worker', async () => {
    const user = userEvent.setup();
    render(<PwaUpdatePrompt />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'O versiune nouă a aplicației este disponibilă.',
    );
    await user.click(
      screen.getByRole('button', { name: 'Actualizează aplicația' }),
    );
    expect(registration.updateServiceWorker).toHaveBeenCalledWith(true);

    await user.click(screen.getByRole('button', { name: 'Mai târziu' }));
    expect(registration.setNeedRefresh).toHaveBeenCalledWith(false);
  });

  it('stays out of the page when no update is waiting', () => {
    registration.needRefresh = false;
    render(<PwaUpdatePrompt />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the prompt open and explains a failed update', async () => {
    const user = userEvent.setup();
    registration.updateServiceWorker.mockRejectedValueOnce(
      new Error('offline'),
    );
    render(<PwaUpdatePrompt />);

    await user.click(
      screen.getByRole('button', { name: 'Actualizează aplicația' }),
    );

    expect(
      await screen.findByText(/Nu am putut actualiza aplicația/),
    ).toBeVisible();
    expect(screen.getByRole('alert')).toBeVisible();
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

  it('stops looking once the prompt is gone', () => {
    const { worker, unmount } = registered();
    unmount();

    act(() => vi.advanceTimersByTime(3 * 60 * MINUTE));
    becomes('hidden');
    becomes('visible');

    expect(worker.update).not.toHaveBeenCalled();
  });
});
