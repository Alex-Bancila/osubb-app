/**
 * When an installed app looks for a new build (#1137). The browser looks
 * only at a navigation, and an installed app on a phone can stay open, or
 * come back from the background, for days: it would keep the old precached
 * `index.html` and the old RPC contract until it was killed. So the app
 * looks on its own — when it comes back to the foreground, at most once in
 * `RETURN_CHECK_MS`, and every `OPEN_CHECK_MS` while it stays on screen. A
 * new build found waits, and `PwaUpdatePrompt` asks before it takes over
 * (`registerType: 'prompt'`): nothing reloads without the Member's tap.
 */
export const RETURN_CHECK_MS = 10 * 60_000;
export const OPEN_CHECK_MS = 60 * 60_000;

/** Starts looking for new builds of `registration`; returns how to stop. */
export function watchForUpdates(
  registration: Pick<ServiceWorkerRegistration, 'update'>,
): () => void {
  // The registration has just looked, at the start: that is the last look.
  let lastLook = Date.now();
  const look = () => {
    lastLook = Date.now();
    // Offline, or the server busy: the next return or hour looks again.
    registration.update().catch(() => undefined);
  };
  const onVisibilityChange = () => {
    if (
      document.visibilityState === 'visible' &&
      Date.now() - lastLook >= RETURN_CHECK_MS
    )
      look();
  };
  // In the background the next return looks instead.
  const timer = window.setInterval(() => {
    if (document.visibilityState === 'visible') look();
  }, OPEN_CHECK_MS);
  document.addEventListener('visibilitychange', onVisibilityChange);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
