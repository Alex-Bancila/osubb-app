// Tests for send-push. Run with `deno test supabase/functions/`.
// The port is faked end to end: no database, no push service, no network.

import { assertEquals } from "@std/assert";
import { BATCH_SIZE, bearerRole, classify, handleSendPush } from "./handler.ts";
import {
  type ClaimedDelivery,
  InvalidSubscriptionError,
  type Outcome,
  type PushResponse,
  type PushSubscriptionJson,
  realDeps,
  type SendPushDeps,
  type Settled,
} from "./deps.ts";
// @ts-types="npm:@types/web-push@3.6.4"
import webpush from "web-push";

const SUBSCRIPTION = JSON.stringify({
  endpoint: "https://push.example/device-1",
  keys: { p256dh: "BPublicKey", auth: "authSecret" },
});

function jwt(claims: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(claims)}.signature`;
}

const SERVICE = `Bearer ${jwt({ role: "service_role", iss: "supabase" })}`;

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
  retryBecomesFailed?: boolean;
} = {}) {
  const batches = [...(options.batches ?? [[row(1)]])];
  const settled: Settlement[] = [];
  const sent: { subscription: PushSubscriptionJson; payload: string }[] = [];
  let claims = 0;

  const deps: SendPushDeps = {
    configProblems: () => options.missing ?? [],
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

function post(authorization: string | null = SERVICE): Request {
  return new Request("http://localhost/send-push", {
    method: "POST",
    headers: authorization ? { Authorization: authorization } : {},
    body: "{}",
  });
}

Deno.test("an anon bearer is refused with 401 and nothing is claimed", async () => {
  const { deps, claimCount } = fakeDeps();
  const anon = `Bearer ${jwt({ role: "anon" })}`;
  assertEquals((await handleSendPush(post(anon), deps)).status, 401);
  assertEquals((await handleSendPush(post(null), deps)).status, 401);
  assertEquals(
    (await handleSendPush(post("Bearer not-a-jwt"), deps)).status,
    401,
  );
  assertEquals(claimCount(), 0);
});

Deno.test("an authenticated Member's bearer is refused with 401", async () => {
  const { deps, claimCount } = fakeDeps();
  const member = `Bearer ${jwt({ role: "authenticated", sub: "member-1" })}`;
  assertEquals((await handleSendPush(post(member), deps)).status, 401);
  assertEquals(claimCount(), 0);
});

Deno.test("only POST is accepted", async () => {
  const { deps } = fakeDeps();
  const get = new Request("http://localhost/send-push", {
    headers: { Authorization: SERVICE },
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

Deno.test("the payload is the Notification's id, title, body and link and nothing else", async () => {
  const { deps, sent } = fakeDeps();
  await handleSendPush(post(), deps);
  assertEquals(sent[0].subscription, {
    endpoint: "https://push.example/device-1",
    keys: { p256dh: "BPublicKey", auth: "authSecret" },
  });
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

Deno.test("bearerRole reads the role claim and rejects anything else", () => {
  assertEquals(bearerRole(SERVICE), "service_role");
  assertEquals(bearerRole(null), null);
  assertEquals(bearerRole("Basic abc"), null);
  assertEquals(bearerRole("Bearer a.!!!.c"), null);
  assertEquals(bearerRole(`Bearer ${jwt({ sub: "x" })}`), null);
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
    "SUPABASE_SERVICE_ROLE_KEY",
    "VAPID_PUBLIC_KEY",
    "VAPID_PRIVATE_KEY",
    "VAPID_SUBJECT",
  ];
  const saved = names.map((name) => [name, Deno.env.get(name)] as const);
  try {
    const pair = webpush.generateVAPIDKeys();
    Deno.env.set("SUPABASE_URL", "http://localhost:54321");
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key");
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
