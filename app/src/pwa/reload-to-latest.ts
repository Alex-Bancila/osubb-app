/**
 * Reload the page onto the newest deployed build (#860, Audit D D-19).
 *
 * A plain `location.reload()` is not enough under `registerType: 'prompt'`:
 * the service worker in control keeps answering navigations with the
 * precached `index.html` of the old build until a new worker takes over. So
 * this asks the registration for an update, lets a new worker that is waiting
 * (or finishes installing within a few seconds) take control with the same
 * `SKIP_WAITING` message `PwaUpdatePrompt` sends, and reloads once it does.
 * Without a service worker, or on any failure, it simply reloads.
 */
const INSTALL_WAIT_MS = 10_000;
const TAKEOVER_WAIT_MS = 5_000;

function installed(worker: ServiceWorker): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      window.clearTimeout(timer);
      worker.removeEventListener('statechange', onChange);
      resolve();
    };
    const onChange = () => {
      if (worker.state !== 'installing') done();
    };
    const timer = window.setTimeout(done, INSTALL_WAIT_MS);
    worker.addEventListener('statechange', onChange);
  });
}

export async function reloadToLatestVersion(): Promise<void> {
  const reload = () => window.location.reload();
  try {
    const container = navigator.serviceWorker as
      ServiceWorkerContainer | undefined;
    const registration = await container?.getRegistration();
    if (container && registration) {
      await registration.update();
      if (!registration.waiting && registration.installing)
        await installed(registration.installing);
      const waiting = registration.waiting;
      if (waiting) {
        container.addEventListener('controllerchange', reload, { once: true });
        // Should the new worker never take over, reload all the same.
        window.setTimeout(reload, TAKEOVER_WAIT_MS);
        waiting.postMessage({ type: 'SKIP_WAITING' });
        return;
      }
    }
  } catch {
    // An update check that fails (offline, no worker) still reloads.
  }
  reload();
}
