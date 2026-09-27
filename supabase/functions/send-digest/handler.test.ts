// Tests for send-digest. Run with `deno test supabase/functions/`.
// The port is faked end to end: no database, no Resend, no network.

import { assert, assertEquals, assertFalse } from "@std/assert";
import {
  BATCH_SIZE,
  classify,
  handleSendDigest,
  MAX_BATCHES,
  SEND_GAP_MS,
} from "./handler.ts";
import {
  type ClaimedDigest,
  type DigestOutcome,
  type EmailMessage,
  isSender,
  postToResend,
  type ProviderResponse,
  type SendDigestDeps,
} from "./deps.ts";

// A made-up key in the sb_secret_ shape; never a real one.
const SECRET = "sb_secret_test0000000000000000000000000000";

function row(id: number): ClaimedDigest {
  return {
    digest_id: id,
    attempt: 1,
    email: `membru${id}@example.org`,
    member_name: `Membru ${id}`,
    unread_count: 1,
    items: [{
      id: 100 + id,
      title: `Titlu ${id}`,
      body: "Corp",
      link: `/tracker/${id}`,
      created_at: "2026-09-27T11:05:00Z",
    }],
  };
}

interface Settlement {
  id: number;
  attempt: number;
  outcome: DigestOutcome;
  error: string | null;
  providerId: string | null;
}

/**
 * A fake port. `queue` is what the database would hand out; like the real
 * claim, it never hands out more than `quota` digests in total.
 */
function fakeDeps(options: {
  queue?: ClaimedDigest[];
  quota?: number;
  answer?: (message: EmailMessage, index: number) => ProviderResponse | Error;
  problems?: string[];
  origin?: string | null;
  keys?: string[];
} = {}) {
  const queue = [...(options.queue ?? [])];
  let quota = options.quota ?? Infinity;
  const sent: EmailMessage[] = [];
  const settled: Settlement[] = [];
  const claims: number[] = [];
  const pauses: number[] = [];
  const deps: SendDigestDeps = {
    secretKeys: () => options.keys ?? [SECRET],
    configProblems: () => options.problems ?? [],
    appOrigin: () =>
      options.origin === undefined ? "https://app.osubb.ro" : options.origin,
    sender: () => "OSUBB <noreply@app.osubb.ro>",
    claim: (limit) => {
      claims.push(limit);
      const take = Math.min(limit, quota, queue.length);
      quota -= take;
      return Promise.resolve(queue.splice(0, take));
    },
    settle: (id, attempt, outcome, error, providerId) => {
      settled.push({ id, attempt, outcome, error, providerId });
      return Promise.resolve(
        outcome === "sent"
          ? "sent"
          : outcome === "failed"
          ? "failed"
          : "pending",
      );
    },
    send: (message) => {
      const index = sent.length;
      sent.push(message);
      const answer = options.answer?.(message, index) ??
        { status: 200, body: `{"id":"re_${index}"}` };
      return answer instanceof Error
        ? Promise.reject(answer)
        : Promise.resolve(answer);
    },
    pause: (ms) => {
      pauses.push(ms);
      return Promise.resolve();
    },
  };
  return { deps, sent, settled, claims, pauses };
}

function post(apikey: string | null = SECRET, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (apikey !== null) headers.set("apikey", apikey);
  return new Request("http://localhost/functions/v1/send-digest", {
    method: "POST",
    body: "{}",
    ...init,
    headers,
  });
}

// ==================== Auth ====================

Deno.test("anything but POST is refused", async () => {
  const { deps, claims } = fakeDeps();
  const response = await handleSendDigest(
    new Request("http://localhost/", { method: "GET" }),
    deps,
  );
  assertEquals(response.status, 405);
  assertEquals(claims.length, 0);
});

Deno.test("no apikey, or a wrong one, is 401 and claims nothing", async () => {
  for (const key of [null, "", "sb_secret_wrong", `${SECRET}x`]) {
    const { deps, claims } = fakeDeps({ queue: [row(1)] });
    const response = await handleSendDigest(post(key), deps);
    assertEquals(response.status, 401, `apikey ${key}`);
    assertEquals(await response.json(), { error: "secret key only" });
    assertEquals(claims.length, 0);
  }
});

Deno.test("a legacy JWT on Authorization is not a secret key", async () => {
  const { deps, claims } = fakeDeps({ queue: [row(1)] });
  const response = await handleSendDigest(
    post(null, { headers: { Authorization: "Bearer eyJ.service_role.sig" } }),
    deps,
  );
  assertEquals(response.status, 401);
  assertEquals(claims.length, 0);
});

Deno.test("without any secret key the answer is a generic 500", async () => {
  const { deps, claims } = fakeDeps({ keys: [] });
  const response = await handleSendDigest(post(), deps);
  assertEquals(response.status, 500);
  assertEquals(await response.json(), { error: "configuration" });
  assertEquals(claims.length, 0);
});

Deno.test("a declared body over 1 KB is 413 before anything else", async () => {
  const { deps, claims } = fakeDeps();
  const response = await handleSendDigest(
    post(SECRET, { headers: { "Content-Length": "4096" } }),
    deps,
  );
  assertEquals(response.status, 413);
  assertEquals(claims.length, 0);
});

Deno.test("a missing setting is named after auth, before claiming", async () => {
  const { deps, claims } = fakeDeps({ problems: ["RESEND_API_KEY"] });
  const response = await handleSendDigest(post(), deps);
  assertEquals(response.status, 500);
  assertEquals(await response.json(), {
    error: "configuration",
    problems: ["RESEND_API_KEY"],
  });
  assertEquals(claims.length, 0);

  const wrongKey = fakeDeps({ problems: ["RESEND_API_KEY"] });
  assertEquals(
    (await handleSendDigest(post("nope"), wrongKey.deps)).status,
    401,
    "an unauthenticated caller learns nothing about the configuration",
  );
});

// ==================== Sending ====================

Deno.test("each claimed digest is sent once and settled sent", async () => {
  const { deps, sent, settled, pauses } = fakeDeps({
    queue: [row(1), row(2)],
  });
  const response = await handleSendDigest(post(), deps);
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    claimed: 2,
    sent: 2,
    retried: 0,
    deferred: 0,
    failed: 0,
  });
  assertEquals(sent.map((message) => message.to), [
    "membru1@example.org",
    "membru2@example.org",
  ]);
  assertEquals(sent[0].from, "OSUBB <noreply@app.osubb.ro>");
  assertEquals(sent[0].subject, "Ai o notificare necitită");
  assert(sent[0].text.includes("https://app.osubb.ro/tracker/1"));
  assertEquals(sent[0].idempotencyKey, "osubb-digest-1");
  assertEquals(settled.map((s) => [s.id, s.outcome, s.providerId]), [
    [1, "sent", "re_0"],
    [2, "sent", "re_1"],
  ]);
  assertEquals(
    pauses,
    [SEND_GAP_MS],
    "a pause between two sends, none before the first",
  );
});

// ==================== The quota guard ====================

Deno.test("never sends more than the claim hands out (the quota)", async () => {
  const queue = Array.from({ length: 50 }, (_, index) => row(index + 1));
  const { deps, sent, claims } = fakeDeps({ queue, quota: 7 });
  const response = await handleSendDigest(post(), deps);
  assertEquals(response.status, 200);
  assertEquals(sent.length, 7);
  assertEquals((await response.json()).claimed, 7);
  assertEquals(claims, [BATCH_SIZE], "a short batch ends the run");
});

Deno.test("a run sends at most MAX_BATCHES batches", async () => {
  const queue = Array.from(
    { length: BATCH_SIZE * MAX_BATCHES + 5 },
    (_, index) => row(index + 1),
  );
  const { deps, sent, claims } = fakeDeps({ queue });
  await handleSendDigest(post(), deps);
  assertEquals(sent.length, BATCH_SIZE * MAX_BATCHES);
  assertEquals(claims.length, MAX_BATCHES);
});

Deno.test("Resend's daily quota defers the digest and the rest of the run, unsent", async () => {
  const queue = Array.from(
    { length: BATCH_SIZE },
    (_, index) => row(index + 1),
  );
  const { deps, sent, settled, claims } = fakeDeps({
    queue: [...queue, row(99)],
    answer: (_message, index) =>
      index === 2
        ? {
          status: 429,
          body: '{"statusCode":429,"name":"daily_quota_exceeded"}',
        }
        : undefined as unknown as ProviderResponse,
  });
  const response = await handleSendDigest(post(), deps);
  assertEquals(response.status, 200);
  assertEquals(sent.length, 3, "nothing is sent after the quota answer");
  assertEquals(claims.length, 1, "no further batch is claimed");
  assertEquals(
    settled.map((s) => s.outcome),
    [
      "sent",
      "sent",
      "deferred",
      ...Array(BATCH_SIZE - 3).fill("deferred"),
    ],
  );
  assertEquals(settled[3].error, "provider_quota");
  const summary = await response.json();
  assertEquals([summary.sent, summary.deferred], [2, BATCH_SIZE - 2]);
});

Deno.test("a refused API key stops the run with 502 and defers everything", async () => {
  const { deps, sent, settled } = fakeDeps({
    queue: [row(1), row(2)],
    answer: () => ({ status: 401, body: '{"name":"validation_error"}' }),
  });
  const response = await handleSendDigest(post(), deps);
  assertEquals(response.status, 502);
  assertEquals(sent.length, 1);
  assertEquals(settled.map((s) => s.outcome), ["deferred", "deferred"]);
});

Deno.test("passing failures retry, a refused address fails, the run goes on", async () => {
  const { deps, settled } = fakeDeps({
    queue: [row(1), row(2), row(3), row(4)],
    answer: (_message, index) =>
      [
        { status: 503, body: "busy" },
        new Error("connection reset"),
        { status: 422, body: '{"name":"validation_error"}' },
        { status: 429, body: '{"name":"rate_limit_exceeded"}' },
      ][index],
  });
  const response = await handleSendDigest(post(), deps);
  assertEquals(response.status, 200);
  assertEquals(settled.map((s) => s.outcome), [
    "retry",
    "retry",
    "failed",
    "retry",
  ]);
  assertEquals(settled[0].error, "HTTP 503: busy");
  assertEquals(settled[1].error, "network: connection reset");
});

Deno.test("classify", () => {
  assertEquals(classify({ status: 200, body: "{}" }).outcome, "sent");
  assertEquals(
    classify({ status: 429, body: '{"name":"monthly_quota_exceeded"}' }),
    { outcome: "deferred", stop: "provider_quota" },
  );
  assertEquals(classify({ status: 403, body: "" }), {
    outcome: "deferred",
    stop: "provider_auth",
  });
  assertEquals(classify({ status: 409, body: "" }).outcome, "failed");
  assertEquals(classify({ status: 500, body: "" }).outcome, "retry");
});

Deno.test("a claim failure is a 500 without the database's message", async () => {
  const { deps } = fakeDeps();
  deps.claim = () => Promise.reject(new Error("permission denied for secret"));
  const response = await handleSendDigest(post(), deps);
  assertEquals(response.status, 500);
  assertFalse(JSON.stringify(await response.json()).includes("permission"));
});

// ==================== The transport ====================

Deno.test("postToResend sends one JSON email with the idempotency key", async () => {
  let seen: Request | null = null;
  const fakeFetch: typeof fetch = (input, init) => {
    seen = new Request(input as string, init);
    return Promise.resolve(
      new Response('{"id":"re_1"}', { status: 200 }),
    );
  };
  const answer = await postToResend("re_test", {
    from: "OSUBB <noreply@app.osubb.ro>",
    to: "ana@example.org",
    subject: "Ai o notificare necitită",
    text: "t",
    html: "<p>h</p>",
    idempotencyKey: "osubb-digest-7",
  }, fakeFetch);
  assertEquals(answer, { status: 200, body: '{"id":"re_1"}' });
  const request = seen as unknown as Request;
  assertEquals(request.url, "https://api.resend.com/emails");
  assertEquals(request.headers.get("authorization"), "Bearer re_test");
  assertEquals(request.headers.get("idempotency-key"), "osubb-digest-7");
  assertEquals((await request.json()).to, ["ana@example.org"]);
});

Deno.test("isSender accepts a name and an address, and nothing that adds a header", () => {
  assert(isSender("OSUBB <noreply@app.osubb.ro>"));
  assert(isSender("OSUBB staging <noreply@app.osubb.ro>"));
  assert(isSender("noreply@app.osubb.ro"));
  assertFalse(isSender("OSUBB <noreply@app.osubb.ro>\r\nBcc: x@y.z"));
  assertFalse(isSender("OSUBB noreply@app.osubb.ro>"));
  assertFalse(isSender("not an address"));
});
