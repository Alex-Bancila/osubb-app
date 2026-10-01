// Tests for request-invitation (#968). Run with `deno test supabase/functions/`.
//
// Named for the damage, as the sibling functions' are: an edit that lets the
// answer depend on whether an address has an account, or that sends without
// the database's say-so, fails with a message that says what it broke.

import { assert, assertEquals } from "@std/assert";
import { clientIpHash, handleRequestInvitation } from "./handler.ts";
import type { RequestInvitationDeps, Verdict } from "./deps.ts";
import { capturingErrors } from "../_shared/test-logs.ts";

const ORIGIN = "http://localhost:5173";

interface FakeOptions {
  verdict?: Verdict;
  verdictError?: Error;
  inviteError?: Error;
}

/** A fake port that records every call, so tests can assert order and absence. */
function fakeDeps(options: FakeOptions = {}) {
  const calls: string[] = [];

  const deps: RequestInvitationDeps = {
    verdict: (email, ipHash) => {
      calls.push(`verdict:${email}:${ipHash}`);
      return options.verdictError
        ? Promise.reject(options.verdictError)
        : Promise.resolve(options.verdict ?? "send");
    },
    inviteByEmail: (email) => {
      calls.push(`inviteByEmail:${email}`);
      return options.inviteError
        ? Promise.reject(options.inviteError)
        : Promise.resolve();
    },
  };

  return { deps, calls };
}

function request(
  body: unknown,
  {
    origin = ORIGIN as string | null,
    method = "POST",
    headers = {} as Record<string, string>,
  } = {},
): Request {
  return new Request("http://localhost/request-invitation", {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(origin ? { Origin: origin } : {}),
      ...headers,
    },
    body: method === "GET" || method === "OPTIONS"
      ? undefined
      : typeof body === "string"
      ? body
      : JSON.stringify(body),
  });
}

const invites = (calls: string[]) =>
  calls.filter((call) => call.startsWith("inviteByEmail"));

// ==================== the gates, before the database ====================

Deno.test("a preflight from the app's origin is answered, a foreign one is refused", async () => {
  const ok = await handleRequestInvitation(
    request(null, { method: "OPTIONS" }),
    fakeDeps().deps,
  );
  assertEquals(ok.status, 200);
  assertEquals(ok.headers.get("Access-Control-Allow-Origin"), ORIGIN);

  const foreign = await handleRequestInvitation(
    request(null, { method: "OPTIONS", origin: "https://evil.example" }),
    fakeDeps().deps,
  );
  assertEquals(foreign.status, 403);
  assertEquals(foreign.headers.get("Access-Control-Allow-Origin"), null);
});

Deno.test("anything but POST is refused with 405 and reaches nothing", async () => {
  const { deps, calls } = fakeDeps();

  const res = await handleRequestInvitation(
    request(null, { method: "GET" }),
    deps,
  );

  assertEquals(res.status, 405);
  assertEquals((await res.json()).code, "method_not_allowed");
  assertEquals(calls, []);
});

Deno.test("a POST from a foreign origin is refused with 403 before the body is read", async () => {
  const { deps, calls } = fakeDeps();

  const res = await handleRequestInvitation(
    request({ email: "ana@exemplu.ro" }, { origin: "https://evil.example" }),
    deps,
  );

  assertEquals(res.status, 403);
  assertEquals((await res.json()).code, "origin_forbidden");
  // No database row, no email: the browser origin is one of the two gates.
  assertEquals(calls, []);
});

Deno.test("a POST with no Origin at all is refused too: a script is not the login page", async () => {
  const { deps, calls } = fakeDeps();

  const res = await handleRequestInvitation(
    request({ email: "ana@exemplu.ro" }, { origin: null }),
    deps,
  );

  assertEquals(res.status, 403);
  assertEquals((await res.json()).code, "origin_forbidden");
  assertEquals(calls, []);
});

Deno.test("a body that is not JSON, not an object, or has no usable address is a 400", async () => {
  const cases: Array<[unknown, string]> = [
    ["{", "invalid_json"],
    [[], "invalid_body"],
    [null, "invalid_body"],
    [{}, "email_invalid"],
    [{ email: 7 }, "email_invalid"],
    [{ email: "   " }, "email_invalid"],
    [{ email: "fara-arond" }, "email_invalid"],
    [{ email: `${"a".repeat(320)}@x.ro` }, "email_invalid"],
  ];
  for (const [body, code] of cases) {
    const { deps, calls } = fakeDeps();
    const res = await handleRequestInvitation(request(body), deps);
    assertEquals(res.status, 400, `${JSON.stringify(body)}`);
    assertEquals((await res.json()).code, code, `${JSON.stringify(body)}`);
    assertEquals(calls, [], `${JSON.stringify(body)} reached the database`);
  }
});

// ==================== the verdicts ====================

Deno.test("'send' re-sends the invitation once, to the trimmed, lower-cased address, and answers 202", async () => {
  const { deps, calls } = fakeDeps({ verdict: "send" });

  const res = await handleRequestInvitation(
    request({ email: "  Ana.Pop@Exemplu.RO " }),
    deps,
  );

  assertEquals(res.status, 202);
  assertEquals(await res.json(), { ok: true });
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  // The database decides first; the email leaves only on its say-so.
  assertEquals(calls, [
    "verdict:ana.pop@exemplu.ro:null",
    "inviteByEmail:ana.pop@exemplu.ro",
  ]);
});

Deno.test("'skip' sends nothing and answers exactly what 'send' answers", async () => {
  const { deps, calls } = fakeDeps({ verdict: "skip" });

  const res = await handleRequestInvitation(
    request({ email: "strain@exemplu.ro" }),
    deps,
  );

  // Unknown, confirmed, signed-in or inactive: the caller cannot tell which,
  // nor tell any of them from an address that was just sent an invitation.
  assertEquals(res.status, 202);
  assertEquals(await res.json(), { ok: true });
  assertEquals(invites(calls), []);
});

Deno.test("'cooldown' sends nothing and answers exactly what 'send' answers", async () => {
  const { deps, calls } = fakeDeps({ verdict: "cooldown" });

  const res = await handleRequestInvitation(
    request({ email: "ana@exemplu.ro" }),
    deps,
  );

  assertEquals(res.status, 202);
  assertEquals(await res.json(), { ok: true });
  assertEquals(invites(calls), []);
});

Deno.test("'ip_limited' is the one verdict the caller hears: 429 rate_limited, no email", async () => {
  const { deps, calls } = fakeDeps({ verdict: "ip_limited" });

  const res = await handleRequestInvitation(
    request({ email: "ana@exemplu.ro" }),
    deps,
  );

  assertEquals(res.status, 429);
  const body = await res.json();
  assertEquals(Object.keys(body).sort(), ["code", "error"]);
  assertEquals(body.code, "rate_limited");
  assertEquals(invites(calls), []);
});

Deno.test("a failed send is logged and still answers 202: the answer never depends on the account", async () => {
  const { deps, calls } = fakeDeps({
    verdict: "send",
    inviteError: new Error("smtp down"),
  });

  const { result: res, logged } = await capturingErrors(() =>
    handleRequestInvitation(request({ email: "ana@exemplu.ro" }), deps)
  );

  assertEquals(res.status, 202);
  assertEquals(await res.json(), { ok: true });
  assertEquals(invites(calls), ["inviteByEmail:ana@exemplu.ro"]);
  assert(logged.includes("smtp down"), "the failure reaches the function log");
  // The log is read by the project's owners, but it still never names the
  // address: the cause is enough to act on.
  assert(!logged.includes("ana@exemplu.ro"), `logged the address: ${logged}`);
});

Deno.test("a database failure is a 500 with a generic body and no email", async () => {
  const { deps, calls } = fakeDeps({
    verdictError: new Error("PGRST301 relation private.invitation_requests"),
  });

  const { result: res, logged } = await capturingErrors(() =>
    handleRequestInvitation(request({ email: "ana@exemplu.ro" }), deps)
  );

  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(Object.keys(body).sort(), ["code", "error"]);
  assertEquals(body.code, "unexpected_error");
  assertEquals(invites(calls), []);
  assert(logged.includes("PGRST301"), "the cause reaches the function log");
  assert(!logged.includes("ana@exemplu.ro"), `logged the address: ${logged}`);
});

// ==================== the caller's IP, as a hash ====================

Deno.test("the IP the database counts is a hash of the first forwarded address, never the address", async () => {
  const { deps, calls } = fakeDeps({ verdict: "skip" });

  await handleRequestInvitation(
    request({ email: "ana@exemplu.ro" }, {
      headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
    }),
    deps,
  );

  const expected = await clientIpHash(
    new Request("http://x", { headers: { "x-real-ip": "203.0.113.7" } }),
  );
  assertEquals(calls, [`verdict:ana@exemplu.ro:${expected}`]);
  assert(!calls[0].includes("203.0.113.7"), "the raw address left the handler");
});

Deno.test("clientIpHash prefers cf-connecting-ip, then x-forwarded-for, then x-real-ip", async () => {
  const hashOf = (headers: Record<string, string>) =>
    clientIpHash(new Request("http://x", { headers }));

  const cf = await hashOf({
    "cf-connecting-ip": "198.51.100.1",
    "x-forwarded-for": "203.0.113.7",
    "x-real-ip": "192.0.2.9",
  });
  const forwarded = await hashOf({
    "x-forwarded-for": " 203.0.113.7 , 10.0.0.1",
    "x-real-ip": "192.0.2.9",
  });
  const real = await hashOf({ "x-real-ip": "192.0.2.9" });

  assertEquals(cf, await hashOf({ "x-real-ip": "198.51.100.1" }));
  assertEquals(forwarded, await hashOf({ "x-real-ip": "203.0.113.7" }));
  assertEquals(real, await hashOf({ "cf-connecting-ip": "192.0.2.9" }));
  for (const hash of [cf, forwarded, real]) {
    assert(hash !== null && /^[0-9a-f]{32}$/.test(hash), `${hash}`);
  }
  assert(cf !== forwarded && forwarded !== real, "distinct addresses collide");
  // The digest itself: SHA-256 of the address text, hex, first 32 characters.
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode("192.0.2.9"),
    ),
  );
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  assertEquals(real, hex.slice(0, 32));
});

Deno.test("clientIpHash is null when no header names the caller", async () => {
  assertEquals(await clientIpHash(new Request("http://x")), null);
  assertEquals(
    await clientIpHash(
      new Request("http://x", { headers: { "x-forwarded-for": " , " } }),
    ),
    null,
  );
});
