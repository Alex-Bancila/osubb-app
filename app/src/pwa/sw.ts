/// <reference lib="webworker" />
/**
 * The OSUBB service worker (ADR-0002, ADR-0010, #704). Built by
 * vite-plugin-pwa in `injectManifest` mode: the plugin replaces
 * `self.__WB_MANIFEST` with the precache list from `pwa-config.ts`.
 *
 * It keeps what the generated worker did — precache the static shell, serve
 * it for navigations except the magic-link landing, never cache Supabase —
 * and adds Web Push: show an incoming Notification and open its link.
 */
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkOnly } from 'workbox-strategies';
import { focusOrOpen, parsePushPayload, targetUrl } from './push-payload';
import { NAVIGATION_DENYLIST, supabaseOriginPattern } from './sw-routes';

declare let self: ServiceWorkerGlobalScope;

// The plugin's injection point: Workbox fixes the name.
// oxlint-disable-next-line no-underscore-dangle
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: NAVIGATION_DENYLIST,
  }),
);

const supabaseRequests = supabaseOriginPattern(
  import.meta.env.VITE_SUPABASE_URL,
);
if (supabaseRequests) registerRoute(supabaseRequests, new NetworkOnly());

/* `registerType: 'prompt'`: a new worker waits until the member accepts the
   update in PwaUpdatePrompt, whose `updateServiceWorker(true)` posts this. */
self.addEventListener('message', (event) => {
  if ((event.data as { type?: unknown } | null)?.type === 'SKIP_WAITING')
    void self.skipWaiting();
});

self.addEventListener('push', (event) => {
  let text: string | null = null;
  try {
    text = event.data?.text() ?? null;
  } catch {
    text = null;
  }
  const payload = parsePushPayload(text);
  if (!payload) return;

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body ?? undefined,
      icon: '/pwa-192x192.png',
      data: { link: payload.link, id: payload.id },
      tag: `osubb-${payload.id}`,
    }),
  );
});

/* The tap writes nothing: marking the Notification read stays the in-app
   list's behaviour (#695, R16). */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data as { link?: unknown } | null;
  const link = typeof data?.link === 'string' ? data.link : null;
  event.waitUntil(
    focusOrOpen(
      self.clients,
      targetUrl(link, self.location.origin),
      self.location.origin,
    ),
  );
});
