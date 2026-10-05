// Tests for the push payload (#778). Run with `deno test supabase/functions/`.

import { assert, assertEquals } from "@std/assert";
import { Buffer } from "node:buffer";
import { createECDH, randomBytes } from "node:crypto";
// @ts-types="npm:@types/web-push@3.6.4"
import webpush from "web-push";
import {
  appOriginOf,
  buildPushPayload,
  MAX_PAYLOAD_BYTES,
  NOTIFICATION_PARAM,
  NOTIFICATIONS_PATH,
  notificationUrl,
  type PushNotification,
  targetUrl,
} from "./payload.ts";

const ORIGIN = "https://app.osubb.ro";

function notification(
  overrides: Partial<PushNotification> = {},
): PushNotification {
  return {
    notification_id: 42,
    title: "Task nou",
    body: "Ai primit „Afiș”.",
    link: "/tracker/12",
    ...overrides,
  };
}

const bytes = (text: string) => new TextEncoder().encode(text).length;

// A long Announcement body: 2000 characters (announcements_body_length_ck),
// diacritics, quotes and new lines -- all of which JSON or UTF-8 widen.
const LONG_BODY = Array.from(
  { length: 100 },
  (_, i) => `Ședința ${i}: „ăîșț”\n`,
).join("").padEnd(2000, "ș").slice(0, 2000);

Deno.test("both shapes in one payload: the service worker's four keys and web_push 8030", () => {
  assertEquals(JSON.parse(buildPushPayload(notification(), ORIGIN)), {
    id: 42,
    title: "Task nou",
    body: "Ai primit „Afiș”.",
    link: "/tracker/12",
    web_push: 8030,
    notification: {
      title: "Task nou",
      body: "Ai primit „Afiș”.",
      navigate: "https://app.osubb.ro/tracker/12?notificare=42",
      tag: "osubb-42",
      lang: "ro",
    },
  });
});

Deno.test("navigate is absolute: a Notification without a link opens the list", () => {
  const payload = JSON.parse(
    buildPushPayload(notification({ body: null, link: null }), ORIGIN),
  );
  assertEquals(payload.body, null);
  assertEquals(payload.link, null);
  assertEquals(payload.notification, {
    title: "Task nou",
    navigate: `https://app.osubb.ro${NOTIFICATIONS_PATH}?notificare=42`,
    tag: "osubb-42",
    lang: "ro",
  });
  assertEquals(new URL(payload.notification.navigate).origin, ORIGIN);
});

Deno.test("targetUrl opens what the service worker's tap opens", () => {
  assertEquals(
    targetUrl("/calendar?event=3", ORIGIN),
    "https://app.osubb.ro/calendar?event=3",
  );
  for (
    const link of [
      null,
      "",
      "   ",
      "https://evil.test/phish",
      "//evil.test/phish",
      String.raw`/\evil.test/phish`,
      "/\t/evil.test/phish",
      "tracker/12",
    ]
  ) {
    assertEquals(
      targetUrl(link, ORIGIN),
      "https://app.osubb.ro/notificari",
      `link ${link}`,
    );
  }
});

Deno.test("without an origin the payload is the service worker's shape only", () => {
  assertEquals(JSON.parse(buildPushPayload(notification(), null)), {
    id: 42,
    title: "Task nou",
    body: "Ai primit „Afiș”.",
    link: "/tracker/12",
  });
});

Deno.test("the app origin is the first ALLOWED_ORIGINS entry, https only", () => {
  assertEquals(appOriginOf(["https://app.osubb.ro"]), ORIGIN);
  assertEquals(appOriginOf(["https://app.osubb.ro/"]), ORIGIN);
  assertEquals(
    appOriginOf(["https://osubb-staging.pages.dev", "https://app.osubb.ro"]),
    "https://osubb-staging.pages.dev",
  );
  // The local default, a malformed entry and nothing at all: no navigate.
  assertEquals(appOriginOf(["http://localhost:5173"]), null);
  assertEquals(appOriginOf(["app.osubb.ro"]), null);
  assertEquals(appOriginOf([]), null);
});

Deno.test("a long body is cut on a code point, with an ellipsis, the same in both shapes", () => {
  const text = buildPushPayload(notification({ body: LONG_BODY }), ORIGIN);
  assert(bytes(text) <= MAX_PAYLOAD_BYTES, `${bytes(text)} bytes`);
  // Close to the budget: the body is cut, not dropped.
  assert(bytes(text) > MAX_PAYLOAD_BYTES - 16, `${bytes(text)} bytes`);

  const payload = JSON.parse(text);
  assert(payload.body.endsWith("…"));
  assert(LONG_BODY.startsWith(payload.body.slice(0, -1)));
  assert(!/[\uD800-\uDBFF]$/.test(payload.body.slice(0, -1)));
  assertEquals(payload.notification.body, payload.body);
  assertEquals(payload.title, "Task nou");
  assertEquals(payload.link, "/tracker/12");
  assertEquals(
    payload.notification.navigate,
    `${ORIGIN}/tracker/12?notificare=42`,
  );
});

Deno.test("a body that fits is never cut", () => {
  const body = "ș".repeat(500);
  const payload = JSON.parse(
    buildPushPayload(notification({ body }), ORIGIN),
  );
  assertEquals(payload.body, body);
});

Deno.test("an emoji is never split in half", () => {
  const body = "😀".repeat(2000);
  const text = buildPushPayload(notification({ body }), ORIGIN, 1_000);
  assert(bytes(text) <= 1_000);
  const cut = JSON.parse(text).body as string;
  assertEquals(cut.slice(0, -1), "😀".repeat(Array.from(cut).length - 1));
});

Deno.test("a title or link that overflows alone: the link goes, then the title is cut", () => {
  const text = buildPushPayload(
    notification({
      title: "Ț".repeat(3000),
      link: `/tracker/${"9".repeat(3000)}`,
    }),
    ORIGIN,
  );
  assert(bytes(text) <= MAX_PAYLOAD_BYTES, `${bytes(text)} bytes`);
  const payload = JSON.parse(text);
  assertEquals(payload.body, null);
  assertEquals(payload.link, null);
  assertEquals(
    payload.notification.navigate,
    `${ORIGIN}/notificari?notificare=42`,
  );
  assert(payload.title.startsWith("Ț") && payload.title.endsWith("…"));
  assertEquals(payload.notification.title, payload.title);
});

Deno.test("the longest payload encrypts to one push message of at most 4096 bytes", () => {
  const vapid = webpush.generateVAPIDKeys();
  const device = createECDH("prime256v1");
  device.generateKeys();
  const subscription = {
    endpoint: "https://push.example/device-1",
    keys: {
      p256dh: Buffer.from(device.getPublicKey()).toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    },
  };
  const payload = buildPushPayload(notification({ body: LONG_BODY }), ORIGIN);
  const request = webpush.generateRequestDetails(subscription, payload, {
    vapidDetails: {
      subject: "mailto:it@osubb.ro",
      publicKey: vapid.publicKey,
      privateKey: vapid.privateKey,
    },
  });
  assert(request.body !== null);
  assert(request.body.length <= 4096, `${request.body.length} bytes`);
});

Deno.test("#1012: navigate carries the Notification's id, appended to the link's own query", () => {
  const payload = JSON.parse(
    buildPushPayload(
      notification({
        notification_id: 7,
        link: "/administrare/grupuri/3?tab=cereri",
      }),
      ORIGIN,
    ),
  );
  const url = new URL(payload.notification.navigate);
  assertEquals(url.pathname, "/administrare/grupuri/3");
  assertEquals(url.searchParams.get("tab"), "cereri");
  assertEquals(url.searchParams.get(NOTIFICATION_PARAM), "7");
  // The service worker's half keeps the bare link: it adds the id itself.
  assertEquals(payload.link, "/administrare/grupuri/3?tab=cereri");
});

Deno.test("#1012: notificationUrl never adds a nonsense id", () => {
  assertEquals(
    notificationUrl("/tracker?task=4", ORIGIN, 0),
    `${ORIGIN}/tracker?task=4`,
  );
  assertEquals(
    notificationUrl("https://evil.example/x", ORIGIN, 5),
    `${ORIGIN}/notificari?notificare=5`,
  );
});
