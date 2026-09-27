// Tests for resend-webhook. Run with `deno test supabase/functions/`.
// The port is faked end to end: no database and no real signing secret --
// the one below is built at run time from a made-up string.

import { assert, assertEquals } from "@std/assert";
import type { HandledEvent, ResendWebhookDeps } from "./deps.ts";
import {
  handleResendWebhook,
  MAX_BODY_BYTES,
  readBodyCapped,
  reasonOf,
  recipients,
} from "./handler.ts";
import {
  decodeSigningSecret,
  sign,
  TIMESTAMP_TOLERANCE_SECONDS,
  verifySignature,
} from "./signature.ts";

const SIGNING_SECRET = `whsec_${
  btoa("made-up signing secret, not a real one")
}`;
const KEY = decodeSigningSecret(SIGNING_SECRET)!;
const NOW = 1_790_000_000;

interface Call {
  email: string;
  event: HandledEvent;
  reason: string | null;
}

function fakeDeps(options: {
  secret?: string;
  hasSecretKey?: boolean;
  notified?: number;
  fail?: boolean;
} = {}): ResendWebhookDeps & { calls: Call[]; deliveryIds: string[] } {
  const calls: Call[] = [];
  const deliveryIds: string[] = [];
  return {
    calls,
    deliveryIds,
    signingSecret: () => options.secret ?? SIGNING_SECRET,
    hasSecretKey: () => options.hasSecretKey ?? true,
    nowSeconds: () => NOW,
    notify(deliveryId, email, event, reason) {
      deliveryIds.push(deliveryId);
      calls.push({ email, event, reason });
      if (options.fail) return Promise.reject(new Error("db down"));
      return Promise.resolve(options.notified ?? 2);
    },
  };
}

function event(type: string, data: Record<string, unknown>): string {
  return JSON.stringify({
    type,
    created_at: "2026-09-27T10:00:00.000Z",
    data: {
      email_id: "56761188-7520-42d8-8898-ff6fc54ce618",
      from: "OSUBB <noreply@app.osubb.ro>",
      subject: "Ai fost invitat în aplicația OSUBB",
      ...data,
    },
  });
}

const BOUNCE_MESSAGE =
  "The recipient mail server permanently rejected the email.";

const BOUNCED = event("email.bounced", {
  to: ["ana@example.ro"],
  bounce: { type: "Permanent", subType: "General", message: BOUNCE_MESSAGE },
});

async function signed(
  body: string,
  options: {
    timestamp?: number;
    signature?: string;
    id?: string | null;
    method?: string;
  } = {},
): Promise<Request> {
  const id = options.id === undefined ? "msg_2TestId" : options.id;
  const timestamp = String(options.timestamp ?? NOW);
  const headers = new Headers({ "Content-Type": "application/json" });
  if (id !== null) {
    headers.set("svix-id", id);
    headers.set("svix-timestamp", timestamp);
    headers.set(
      "svix-signature",
      options.signature ?? `v1,${await sign(KEY, id, timestamp, body)}`,
    );
  }
  return new Request("http://localhost/functions/v1/resend-webhook", {
    method: options.method ?? "POST",
    headers,
    body: options.method === "GET" ? undefined : body,
  });
}

// ==================== Signature ====================

Deno.test("a correctly signed bounce is accepted and notifies", async () => {
  const deps = fakeDeps();
  const response = await handleResendWebhook(await signed(BOUNCED), deps);
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { notified: 2 });
  assertEquals(deps.calls, [{
    email: "ana@example.ro",
    event: "email.bounced",
    reason: `Permanent/General: ${BOUNCE_MESSAGE}`,
  }]);
});

Deno.test("missing signature headers are refused with 401, nothing written", async () => {
  const deps = fakeDeps();
  const response = await handleResendWebhook(
    await signed(BOUNCED, { id: null }),
    deps,
  );
  assertEquals(response.status, 401);
  assertEquals(deps.calls, []);
});

Deno.test("a wrong signature is refused with 401, nothing written", async () => {
  const deps = fakeDeps();
  const wrongKey = decodeSigningSecret(`whsec_${btoa("another secret")}`)!;
  const forged = `v1,${await sign(
    wrongKey,
    "msg_2TestId",
    String(NOW),
    BOUNCED,
  )}`;
  const response = await handleResendWebhook(
    await signed(BOUNCED, { signature: forged }),
    deps,
  );
  assertEquals(response.status, 401);
  assertEquals(deps.calls, []);
});

Deno.test("a body changed after signing is refused", async () => {
  const deps = fakeDeps();
  const request = await signed(BOUNCED);
  const tampered = new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: BOUNCED.replace("ana@example.ro", "bc@example.ro"),
  });
  const response = await handleResendWebhook(tampered, deps);
  assertEquals(response.status, 401);
  assertEquals(deps.calls, []);
});

Deno.test("a signature with another version tag does not count", async () => {
  const deps = fakeDeps();
  const good = await sign(KEY, "msg_2TestId", String(NOW), BOUNCED);
  const response = await handleResendWebhook(
    await signed(BOUNCED, { signature: `v2,${good}` }),
    deps,
  );
  assertEquals(response.status, 401);
});

Deno.test("one matching entry among several signatures is enough", async () => {
  const deps = fakeDeps();
  const good = await sign(KEY, "msg_2TestId", String(NOW), BOUNCED);
  const response = await handleResendWebhook(
    await signed(BOUNCED, { signature: `v1,bm90IGl0 v1,${good}` }),
    deps,
  );
  assertEquals(response.status, 200);
});

Deno.test("a timestamp older than five minutes is refused, even correctly signed", async () => {
  const deps = fakeDeps();
  const response = await handleResendWebhook(
    await signed(BOUNCED, {
      timestamp: NOW - TIMESTAMP_TOLERANCE_SECONDS - 1,
    }),
    deps,
  );
  assertEquals(response.status, 401);
  assertEquals(deps.calls, []);
});

Deno.test("a timestamp more than five minutes ahead is refused", async () => {
  const deps = fakeDeps();
  const response = await handleResendWebhook(
    await signed(BOUNCED, {
      timestamp: NOW + TIMESTAMP_TOLERANCE_SECONDS + 1,
    }),
    deps,
  );
  assertEquals(response.status, 401);
});

Deno.test("a timestamp at the edge of the tolerance is accepted", async () => {
  const deps = fakeDeps();
  const response = await handleResendWebhook(
    await signed(BOUNCED, { timestamp: NOW - TIMESTAMP_TOLERANCE_SECONDS }),
    deps,
  );
  assertEquals(response.status, 200);
});

Deno.test("verifySignature names what is wrong", async () => {
  const base = { id: "msg_1", timestamp: String(NOW), body: "{}" };
  const signature = `v1,${await sign(KEY, "msg_1", String(NOW), "{}")}`;
  assertEquals(await verifySignature({ ...base, signature }, KEY, NOW), null);
  assertEquals(
    await verifySignature({ ...base, signature: null }, KEY, NOW),
    "missing_headers",
  );
  assertEquals(
    await verifySignature({ ...base, timestamp: "soon", signature }, KEY, NOW),
    "invalid_timestamp",
  );
  assertEquals(
    await verifySignature({ ...base, signature }, KEY, NOW + 301),
    "stale_timestamp",
  );
  assertEquals(
    await verifySignature({ ...base, signature: "v1,AAAA" }, KEY, NOW),
    "no_matching_signature",
  );
});

Deno.test("sign reproduces the published Svix test vector", async () => {
  // Svix's documented example (the same signature Resend's docs show), so
  // the HMAC is checked against Svix itself, not only against sign().
  // A public documentation value, not a secret.
  const key = decodeSigningSecret("whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw")!; // gitleaks:allow
  assertEquals(
    await sign(
      key,
      "msg_p5jXN8AQM9LWM0D4loKWxJek",
      "1614265330",
      '{"test": 2432232314}',
    ),
    "g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
  );
});

Deno.test("decodeSigningSecret accepts only whsec_<base64>", () => {
  assert(decodeSigningSecret(SIGNING_SECRET));
  assertEquals(decodeSigningSecret(""), null);
  assertEquals(decodeSigningSecret("whsec_"), null);
  assertEquals(decodeSigningSecret("not-a-secret"), null);
  assertEquals(decodeSigningSecret("whsec_***"), null);
});

// ==================== Events ====================

Deno.test("a complaint notifies with no reason", async () => {
  const deps = fakeDeps({ notified: 3 });
  const body = event("email.complained", { to: ["ana@example.ro"] });
  const response = await handleResendWebhook(await signed(body), deps);
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { notified: 3 });
  assertEquals(deps.calls, [{
    email: "ana@example.ro",
    event: "email.complained",
    reason: null,
  }]);
});

Deno.test("a suppression notifies with the Resend type and message", async () => {
  const deps = fakeDeps();
  const body = event("email.suppressed", {
    to: ["ana@example.ro"],
    suppressed: {
      type: "OnAccountSuppressionList",
      message: "The address is on the account-level suppression list.",
    },
  });
  const response = await handleResendWebhook(await signed(body), deps);
  assertEquals(response.status, 200);
  assertEquals(deps.calls, [{
    email: "ana@example.ro",
    event: "email.suppressed",
    reason:
      "OnAccountSuppressionList: The address is on the account-level suppression list.",
  }]);
});

Deno.test("an already-reported address answers notified 0, still 200", async () => {
  const deps = fakeDeps({ notified: 0 });
  const response = await handleResendWebhook(await signed(BOUNCED), deps);
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { notified: 0 });
});

Deno.test("every recipient of the event is reported, bare and once", async () => {
  const deps = fakeDeps({ notified: 1 });
  const body = event("email.bounced", {
    to: ["Ana <ana@example.ro>", "ion@example.ro", "ana@example.ro"],
    bounce: { type: "Permanent" },
  });
  const response = await handleResendWebhook(await signed(body), deps);
  assertEquals(await response.json(), { notified: 2 });
  assertEquals(deps.calls.map((call) => call.email), [
    "ana@example.ro",
    "ion@example.ro",
  ]);
  assertEquals(deps.calls[0].reason, "Permanent");
});

for (
  const type of [
    "email.delivered",
    "email.sent",
    "email.failed",
    "domain.updated",
  ]
) {
  Deno.test(`${type} is ignored: 200, nothing written`, async () => {
    const deps = fakeDeps();
    const body = event(type, { to: ["ana@example.ro"] });
    const response = await handleResendWebhook(await signed(body), deps);
    assertEquals(response.status, 200);
    assertEquals(await response.json(), { notified: 0, ignored: type });
    assertEquals(deps.calls, []);
  });
}

Deno.test("a signed body that is not JSON is a 400", async () => {
  const deps = fakeDeps();
  const response = await handleResendWebhook(await signed("not json"), deps);
  assertEquals(response.status, 400);
  assertEquals(deps.calls, []);
});

Deno.test("a handled event without data is a 400", async () => {
  const deps = fakeDeps();
  const body = JSON.stringify({ type: "email.bounced" });
  const response = await handleResendWebhook(await signed(body), deps);
  assertEquals(response.status, 400);
});

Deno.test("a database failure is a 500, so Resend retries", async () => {
  const deps = fakeDeps({ fail: true });
  const response = await handleResendWebhook(await signed(BOUNCED), deps);
  assertEquals(response.status, 500);
});

// ==================== Method and configuration ====================

Deno.test("anything but POST is a 405", async () => {
  const deps = fakeDeps();
  const response = await handleResendWebhook(
    await signed(BOUNCED, { method: "GET" }),
    deps,
  );
  assertEquals(response.status, 405);
});

Deno.test("a missing signing secret is a 500 naming it, before any check", async () => {
  const deps = fakeDeps({ secret: "" });
  const response = await handleResendWebhook(await signed(BOUNCED), deps);
  assertEquals(response.status, 500);
  assertEquals(await response.json(), {
    error: "configuration",
    problems: ["RESEND_WEBHOOK_SECRET"],
  });
  assertEquals(deps.calls, []);
});

Deno.test("a missing project secret key is a 500 naming it", async () => {
  const deps = fakeDeps({ hasSecretKey: false });
  const response = await handleResendWebhook(await signed(BOUNCED), deps);
  assertEquals(response.status, 500);
  assertEquals((await response.json()).problems, ["SUPABASE_SECRET_KEYS"]);
});

// ==================== Helpers ====================

Deno.test("recipients drops anything without an @", () => {
  assertEquals(recipients(["", "nobody", 7, null]), []);
  assertEquals(recipients("ana@example.ro"), ["ana@example.ro"]);
  assertEquals(recipients(undefined), []);
});

Deno.test("reasonOf reads only the event's own detail", () => {
  assertEquals(
    reasonOf("email.bounced", { suppressed: { message: "x" } }),
    null,
  );
  assertEquals(
    reasonOf("email.suppressed", { suppressed: { message: "x" } }),
    "x",
  );
  assertEquals(
    reasonOf("email.complained", { bounce: { message: "x" } }),
    null,
  );
});

// ==================== Body cap and delivery id (security audit) ====================

Deno.test("the request's svix-id reaches the database as the delivery id", async () => {
  const deps = fakeDeps();
  const body = event("email.bounced", {
    to: ["ana@example.ro", "ion@example.ro"],
    bounce: { type: "Permanent" },
  });
  await handleResendWebhook(await signed(body, { id: "msg_replayed" }), deps);
  assertEquals(deps.deliveryIds, ["msg_replayed", "msg_replayed"]);
});

Deno.test("a body declared over 64 KB is a 413 before any signature check", async () => {
  const deps = fakeDeps();
  const request = await signed(BOUNCED);
  const headers = new Headers(request.headers);
  headers.set("content-length", String(MAX_BODY_BYTES + 1));
  const response = await handleResendWebhook(
    new Request(request.url, { method: "POST", headers, body: BOUNCED }),
    deps,
  );
  assertEquals(response.status, 413);
  assertEquals(deps.calls, []);
});

Deno.test("a streamed body over 64 KB without a length is a 413, correctly signed or not", async () => {
  const deps = fakeDeps();
  const big = event("email.bounced", {
    to: ["ana@example.ro"],
    bounce: { message: "x".repeat(MAX_BODY_BYTES) },
  });
  const signedRequest = await signed(big);
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      // 16 KB at a time, 160 KB in all: without the cap the whole body is
      // read and the request fails the signature (401) instead.
      pulled++;
      controller.enqueue(new Uint8Array(16 * 1024).fill(120));
      if (pulled === 10) controller.close();
    },
  });
  const response = await handleResendWebhook(
    new Request(signedRequest.url, {
      method: "POST",
      headers: signedRequest.headers,
      body: stream,
    }),
    deps,
  );
  assertEquals(response.status, 413);
  assertEquals(deps.calls, []);
  assert(pulled <= 6, `read ${pulled} chunks, expected the cap to stop it`);
});

Deno.test("a body of exactly 64 KB is read in full", async () => {
  const text = "a".repeat(MAX_BODY_BYTES);
  const read = await readBodyCapped(
    new Request("http://localhost/", { method: "POST", body: text }),
    MAX_BODY_BYTES,
  );
  assertEquals(read, text);
  assertEquals(
    await readBodyCapped(
      new Request("http://localhost/", { method: "POST", body: text + "a" }),
      MAX_BODY_BYTES,
    ),
    null,
  );
});

Deno.test("an unsigned body that is not JSON is a 401, never parsed", async () => {
  const deps = fakeDeps();
  const response = await handleResendWebhook(
    new Request("http://localhost/functions/v1/resend-webhook", {
      method: "POST",
      body: "not json",
    }),
    deps,
  );
  assertEquals(response.status, 401);
  assertEquals(deps.calls, []);
});
