// Tests for send-push. Run with `deno test supabase/functions/`.
// The port is faked end to end: no database, no push service, no network.

import { assert, assertEquals, assertRejects } from "@std/assert";
import * as handler from "./handler.ts";
import {
  BATCH_SIZE,
  classify,
  handleSendPush,
  isPushServiceEndpoint,
} from "./handler.ts";
import {
  type ClaimedDelivery,
  InvalidSubscriptionError,
  MAX_RESPONSE_BODY_BYTES,
  type Outcome,
  postToPushService,
  type PushResponse,
  type PushSubscriptionJson,
  readCapped,
  realDeps,
  type SendPushDeps,
  type Settled,
} from "./deps.ts";
// @ts-types="npm:@types/web-push@3.6.4"
import webpush from "web-push";

const SUBSCRIPTION = JSON.stringify({
  endpoint: "https://fcm.googleapis.com/fcm/send/device-1",
  keys: { p256dh: "BPublicKey", auth: "authSecret" },
});

function jwt(claims: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(claims)}.signature`;
}

// A made-up key in the sb_secret_ shape; never a real one.
const SECRET = "sb_secret_test0000000000000000000000000000";

function row(id: number, token = SUBSCRIPTION): ClaimedDelivery {
  return {
    delivery_id: id,
    attempt: 1,
    token,
    notification_id: 1000 + id,
    title: `Titlu ${id}`,
    body: "Corp",
    link: `/tracker/${id}`,
  };
}

interface Settlement {
  id: number;
  attempt: number;
  outcome: Outcome;
  error: string | null;
}

/**
 * A fake port. `answers` maps an endpoint to the push service's answer (or an
 * Error to throw). Settling mimics the database: retry answers pending,
 * dead answers dead, and so on, so the summary can be checked.
 */
function fakeDeps(options: {
  batches?: ClaimedDelivery[][];
  answer?: (endpoint: string) => PushResponse | Error;
  missing?: string[];
  keys?: string[];
  retryBecomesFailed?: boolean;
  origin?: string | null;
} = {}) {
  const batches = [...(options.batches ?? [[row(1)]])];
  const settled: Settlement[] = [];
  const sent: { subscription: PushSubscriptionJson; payload: string }[] = [];
  let claims = 0;

  const deps: SendPushDeps = {
    secretKeys: () => options.keys ?? [SECRET],
    configProblems: () => options.missing ?? [],
    appOrigin: () =>
      options.origin === undefined ? "https://app.osubb.ro" : options.origin,
    claim: (limit) => {
      claims++;
      assertEquals(limit, BATCH_SIZE);
      return Promise.resolve(batches.shift() ?? []);
    },
    settle: (id, attempt, outcome, error) => {
      settled.push({ id, attempt, outcome, error });
      const status: Settled = outcome === "retry"
        ? (options.retryBecomesFailed ? "failed" : "pending")
        : outcome;
      return Promise.resolve(status);
    },
    send: (subscription, payload) => {
      sent.push({ subscription, payload });
      const answer = options.answer?.(subscription.endpoint) ??
        { status: 201, body: "" };
      return answer instanceof Error
        ? Promise.reject(answer)
        : Promise.resolve(answer);
    },
  };
  return { deps, settled, sent, claimCount: () => claims };
}

function post(
  apikey: string | null = SECRET,
  extra: Record<string, string> = {},
): Request {
  return new Request("http://localhost/send-push", {
    method: "POST",
    headers: { ...(apikey === null ? {} : { apikey }), ...extra },
    body: "{}",
  });
}

Deno.test("a missing or wrong apikey is refused with 401 and nothing is claimed", async () => {
  const { deps, claimCount } = fakeDeps();
  for (
    const apikey of [
      null,
      "",
      "sb_secret_wrong",
      SECRET.slice(0, -1),
      `${SECRET}x`,
      `Bearer ${SECRET}`,
      "sb_publishable_test0000000000000000000000000",
    ]
  ) {
    const response = await handleSendPush(post(apikey), deps);
    assertEquals(response.status, 401, `apikey ${apikey}`);
  }
  assertEquals(claimCount(), 0);
});

Deno.test("the exact secret key on apikey is accepted", async () => {
  const { deps, claimCount } = fakeDeps();
  const response = await handleSendPush(post(SECRET), deps);
  assertEquals(response.status, 200);
  assertEquals(claimCount(), 1);
});

Deno.test("any of the project's secret keys is accepted, and only those", async () => {
  const { deps } = fakeDeps({ keys: ["sb_secret_first", "sb_secret_second"] });
  assertEquals(
    (await handleSendPush(post("sb_secret_second"), deps)).status,
    200,
  );
  assertEquals((await handleSendPush(post(SECRET), deps)).status, 401);
});

Deno.test("no role parsing remains: a service_role JWT bearer without the key is refused", async () => {
  const { deps, claimCount } = fakeDeps();
  const service = `Bearer ${jwt({ role: "service_role", iss: "supabase" })}`;
  // The legacy shape of the cron call: a service_role JWT as bearer, on
  // Authorization and on apikey. Neither is a secret key any more.
  assertEquals(
    (await handleSendPush(post(null, { Authorization: service }), deps)).status,
    401,
  );
  assertEquals(
    (await handleSendPush(
      post(service.slice(7), { Authorization: service }),
      deps,
    ))
      .status,
    401,
  );
  assertEquals(claimCount(), 0);
  assertEquals("bearerRole" in handler, false);
});

Deno.test("with no secret key provided the function answers 500 naming the setting", async () => {
  const { deps, claimCount } = fakeDeps({ keys: [] });
  const response = await handleSendPush(post(SECRET), deps);
  assertEquals(response.status, 500);
  assertEquals((await response.json()).problems, ["SUPABASE_SECRET_KEYS"]);
  assertEquals(claimCount(), 0);
});

Deno.test("only POST is accepted", async () => {
  const { deps } = fakeDeps();
  const get = new Request("http://localhost/send-push", {
    headers: { apikey: SECRET },
  });
  assertEquals((await handleSendPush(get, deps)).status, 405);
});

Deno.test("a missing VAPID secret answers 500 before claiming anything", async () => {
  const { deps, claimCount } = fakeDeps({ missing: ["VAPID_PRIVATE_KEY"] });
  const response = await handleSendPush(post(), deps);
  assertEquals(response.status, 500);
  assertEquals((await response.json()).problems, ["VAPID_PRIVATE_KEY"]);
  assertEquals(claimCount(), 0);
});

Deno.test("201 settles the row sent", async () => {
  const { deps, settled } = fakeDeps({
    answer: () => ({ status: 201, body: "" }),
  });
  const response = await handleSendPush(post(), deps);
  assertEquals(response.status, 200);
  assertEquals(settled, [{ id: 1, attempt: 1, outcome: "sent", error: null }]);
  assertEquals(await response.json(), {
    claimed: 1,
    sent: 1,
    retried: 0,
    dead: 0,
    failed: 0,
  });
});

Deno.test("410 settles the row dead, which deletes the push token", async () => {
  const { deps, settled } = fakeDeps({
    answer: () => ({ status: 410, body: "Gone" }),
  });
  const summary = await (await handleSendPush(post(), deps)).json();
  assertEquals(settled, [{
    id: 1,
    attempt: 1,
    outcome: "dead",
    error: "HTTP 410: Gone",
  }]);
  assertEquals(summary.dead, 1);
});

Deno.test("404 is a dead subscription too", () => {
  assertEquals(classify(404), "dead");
});

Deno.test("503 settles the row for a retry with backoff", async () => {
  const { deps, settled } = fakeDeps({
    answer: () => ({ status: 503, body: "busy" }),
  });
  const summary = await (await handleSendPush(post(), deps)).json();
  assertEquals(settled, [{
    id: 1,
    attempt: 1,
    outcome: "retry",
    error: "HTTP 503: busy",
  }]);
  assertEquals(summary.retried, 1);
});

Deno.test("a retry the database turns failed on the fifth attempt counts as failed", async () => {
  const { deps } = fakeDeps({
    answer: () => ({ status: 429, body: "" }),
    retryBecomesFailed: true,
  });
  const summary = await (await handleSendPush(post(), deps)).json();
  assertEquals([summary.retried, summary.failed], [0, 1]);
});

Deno.test("a network error is retried", async () => {
  const { deps, settled } = fakeDeps({
    answer: () => new TypeError("connection reset"),
  });
  await handleSendPush(post(), deps);
  assertEquals(settled, [{
    id: 1,
    attempt: 1,
    outcome: "retry",
    error: "network: connection reset",
  }]);
});

Deno.test("400 fails the row at once and keeps the push service's answer", async () => {
  const { deps, settled } = fakeDeps({
    answer: () => ({ status: 400, body: "bad VAPID" }),
  });
  const summary = await (await handleSendPush(post(), deps)).json();
  assertEquals(settled, [{
    id: 1,
    attempt: 1,
    outcome: "failed",
    error: "HTTP 400: bad VAPID",
  }]);
  assertEquals(summary.failed, 1);
});

Deno.test("the status table: 2xx sent, 404/410 dead, 429/5xx retry, other failed", () => {
  assertEquals(
    [200, 201, 202, 400, 401, 403, 404, 410, 413, 429, 500, 502, 503].map(
      classify,
    ),
    [
      "sent",
      "sent",
      "sent",
      "failed",
      "failed",
      "failed",
      "dead",
      "dead",
      "failed",
      "retry",
      "retry",
      "retry",
      "retry",
    ],
  );
});

Deno.test("an unreadable subscription fails without a send and without deleting the device", async () => {
  const { deps, settled, sent } = fakeDeps({
    batches: [[
      row(1, "not json"),
      row(2, JSON.stringify({ endpoint: "http://insecure.example/x" })),
    ]],
  });
  await handleSendPush(post(), deps);
  assertEquals(sent.length, 0);
  assertEquals(settled.map((s) => [s.outcome, s.error]), [
    ["failed", "invalid_subscription"],
    ["failed", "invalid_subscription"],
  ]);
});

Deno.test("a subscription the library cannot encrypt for fails instead of retrying", async () => {
  const { deps, settled } = fakeDeps({
    answer: () => new InvalidSubscriptionError("bad p256dh"),
  });
  await handleSendPush(post(), deps);
  assertEquals(settled[0].outcome, "failed");
  assertEquals(settled[0].error, "invalid_subscription: bad p256dh");
});

Deno.test("the payload is the Notification's id, title, body and link, twice: for the service worker and declaratively (#778)", async () => {
  const { deps, sent } = fakeDeps();
  await handleSendPush(post(), deps);
  assertEquals(sent[0].subscription, {
    endpoint: "https://fcm.googleapis.com/fcm/send/device-1",
    keys: { p256dh: "BPublicKey", auth: "authSecret" },
  });
  assertEquals(JSON.parse(sent[0].payload), {
    id: 1001,
    title: "Titlu 1",
    body: "Corp",
    link: "/tracker/1",
    web_push: 8030,
    notification: {
      title: "Titlu 1",
      body: "Corp",
      navigate: "https://app.osubb.ro/tracker/1",
      tag: "osubb-1001",
      lang: "ro",
    },
  });
});

Deno.test("without an https app origin only the service worker's shape is sent", async () => {
  const { deps, sent } = fakeDeps({ origin: null });
  await handleSendPush(post(), deps);
  assertEquals(JSON.parse(sent[0].payload), {
    id: 1001,
    title: "Titlu 1",
    body: "Corp",
    link: "/tracker/1",
  });
});

Deno.test("a full batch claims again; a short one ends the run", async () => {
  const full = Array.from({ length: BATCH_SIZE }, (_, i) => row(i + 1));
  const { deps, claimCount } = fakeDeps({ batches: [full, [row(999)]] });
  const summary = await (await handleSendPush(post(), deps)).json();
  assertEquals(claimCount(), 2);
  assertEquals(summary.claimed, BATCH_SIZE + 1);
  assertEquals(summary.sent, BATCH_SIZE + 1);
});

Deno.test("an empty outbox claims once and answers zeros", async () => {
  const { deps, claimCount } = fakeDeps({ batches: [] });
  const summary = await (await handleSendPush(post(), deps)).json();
  assertEquals(claimCount(), 1);
  assertEquals(summary, {
    claimed: 0,
    sent: 0,
    retried: 0,
    dead: 0,
    failed: 0,
  });
});

Deno.test("the settle quotes back the attempt the claim leased", async () => {
  const { deps, settled } = fakeDeps({
    batches: [[{ ...row(7), attempt: 3 }]],
  });
  await handleSendPush(post(), deps);
  assertEquals(settled[0].attempt, 3);
});

Deno.test("malformed VAPID settings are a configuration problem, not a subscription one", () => {
  const names = [
    "SUPABASE_URL",
    "SUPABASE_SECRET_KEYS",
    "VAPID_PUBLIC_KEY",
    "VAPID_PRIVATE_KEY",
    "VAPID_SUBJECT",
  ];
  const saved = names.map((name) => [name, Deno.env.get(name)] as const);
  try {
    const pair = webpush.generateVAPIDKeys();
    Deno.env.set("SUPABASE_URL", "http://localhost:54321");
    Deno.env.set("SUPABASE_SECRET_KEYS", `{"default":"${SECRET}"}`);
    assertEquals(realDeps().secretKeys(), [SECRET]);
    Deno.env.set("VAPID_PUBLIC_KEY", pair.publicKey);
    Deno.env.set("VAPID_PRIVATE_KEY", pair.privateKey);
    Deno.env.set("VAPID_SUBJECT", "mailto:it@osubb.ro");
    assertEquals(realDeps().configProblems(), []);

    Deno.env.set("VAPID_PRIVATE_KEY", "too-short");
    assertEquals(realDeps().configProblems().length, 1);

    // Two valid pairs, crossed: each key is well formed, the pair is not.
    Deno.env.set("VAPID_PRIVATE_KEY", webpush.generateVAPIDKeys().privateKey);
    assertEquals(realDeps().configProblems(), [
      "VAPID_PUBLIC_KEY does not match VAPID_PRIVATE_KEY",
    ]);

    Deno.env.set("VAPID_PRIVATE_KEY", pair.privateKey);
    Deno.env.set("VAPID_SUBJECT", "it@osubb.ro");
    assertEquals(realDeps().configProblems().length, 1);

    Deno.env.delete("VAPID_SUBJECT");
    assertEquals(realDeps().configProblems(), ["VAPID_SUBJECT"]);
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
});

// ==================== Security pass M2: where send-push may POST ====================

Deno.test("the browser vendors' push services are allowed endpoints", () => {
  for (
    const endpoint of [
      "https://fcm.googleapis.com/fcm/send/device-1",
      "https://updates.push.services.mozilla.com/wpush/v2/device-2",
      "https://web.push.apple.com/device-3",
      "https://wns2-par02p.notify.windows.com/w/?token=device-4",
    ]
  ) {
    assert(isPushServiceEndpoint(endpoint), endpoint);
  }
});

Deno.test("an endpoint off the push services is never fetched and never deletes the device", async () => {
  const endpoints = [
    "https://evil.example/collect",
    "https://127.0.0.1/internal",
    "https://[::1]/internal",
    "https://fcm.googleapis.com:8443/fcm/send/x",
    "https://me@fcm.googleapis.com/fcm/send/x",
    "https://fcm.googleapis.com.evil.example/x",
    "https://evilpush.apple.com/x",
  ];
  const { deps, settled, sent } = fakeDeps({
    batches: [
      endpoints.map((endpoint, index) =>
        row(
          index + 1,
          JSON.stringify({
            endpoint,
            keys: { p256dh: "BPublicKey", auth: "authSecret" },
          }),
        )
      ),
    ],
  });
  await handleSendPush(post(), deps);
  assertEquals(sent.length, 0);
  assertEquals(
    settled.map((s) => [s.outcome, s.error]),
    endpoints.map(() => ["failed", "endpoint_not_allowed"]),
  );
});

/** A body of `total` bytes of "a", produced lazily; records a cancel. */
function streamingResponse(total: number | null) {
  let produced = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (total !== null && produced >= total) {
        controller.close();
        return;
      }
      const size = total === null ? 4096 : Math.min(4096, total - produced);
      produced += size;
      controller.enqueue(new Uint8Array(size).fill(97));
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    response: new Response(body, { status: 400 }),
    produced: () => produced,
    cancelled: () => cancelled,
  };
}

Deno.test("a push service's answer is read to at most 1 KB, and an endless one is cancelled", async () => {
  const endless = streamingResponse(null);
  const text = await readCapped(endless.response);
  assertEquals(text.length, MAX_RESPONSE_BODY_BYTES);
  assert(endless.cancelled());
  assert(endless.produced() < 64 * 1024, `read ${endless.produced()} bytes`);

  const short = streamingResponse(10);
  assertEquals(await readCapped(short.response), "a".repeat(10));
  assertEquals(await readCapped(new Response(null, { status: 201 })), "");
});

const PUSH_REQUEST = {
  endpoint: "https://fcm.googleapis.com/fcm/send/device-1",
  method: "POST",
  headers: { TTL: "86400" },
  body: new Uint8Array([1, 2, 3]),
};

Deno.test("a delivery keeps only the first 1 KB of the answer, refuses redirects and carries a timeout", async () => {
  let init: RequestInit | undefined;
  const huge = streamingResponse(10 * 1024 * 1024);
  const fakeFetch = ((_url: string, options?: RequestInit) => {
    init = options;
    return Promise.resolve(huge.response);
  }) as typeof fetch;
  const answer = await postToPushService(PUSH_REQUEST, fakeFetch);
  assertEquals(answer.status, 400);
  assertEquals(answer.body.length, MAX_RESPONSE_BODY_BYTES);
  assert(huge.cancelled());
  assertEquals(init?.redirect, "error");
  assert(init?.signal instanceof AbortSignal);
});

Deno.test("a push service that never answers is abandoned at the timeout (then retried as a network error)", async () => {
  const hangingFetch =
    ((_url: string, options?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        options?.signal?.addEventListener(
          "abort",
          () => reject(options.signal?.reason),
        );
      })) as typeof fetch;
  const started = Date.now();
  await assertRejects(() => postToPushService(PUSH_REQUEST, hangingFetch, 50));
  assert(Date.now() - started < 5_000);
});
