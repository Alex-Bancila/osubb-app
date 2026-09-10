// Tests for invite-member. Run with `deno test supabase/functions/`.
//
// Three of these exist because the bug happened. They are named for the
// damage, not for the code path, so a future edit that "simplifies" the
// ordering fails with a message that says what it broke.

import { assertEquals } from "jsr:@std/assert@^1";
import { handleInvite } from "./handler.ts";
import type { DbError, InviteDeps, ProvisionArgs } from "./deps.ts";

interface FakeOptions {
  callerId?: string | null;
  level?: number;
  missing?: Record<string, string[]>;
  profileExists?: boolean;
  inviteError?: DbError & { status?: number };
  provisionError?: DbError;
}

/** A fake port that records every call, so tests can assert what did NOT happen. */
function fakeDeps(options: FakeOptions = {}) {
  const calls: string[] = [];
  const provisioned: ProvisionArgs[] = [];

  const deps: InviteDeps = {
    callerId: () => {
      calls.push("callerId");
      return Promise.resolve(options.callerId === undefined ? "caller-1" : options.callerId);
    },
    memberLevel: () => {
      calls.push("memberLevel");
      return Promise.resolve(options.level ?? 6);
    },
    missingIds: (table, ids) => {
      if (ids.length > 0) calls.push(`missingIds:${table}`);
      return Promise.resolve(options.missing?.[table] ?? []);
    },
    profileExists: () => {
      calls.push("profileExists");
      return Promise.resolve(options.profileExists ?? false);
    },
    inviteByEmail: () => {
      calls.push("inviteByEmail");
      return Promise.resolve(
        options.inviteError ? { error: options.inviteError } : { userId: "new-user-1" },
      );
    },
    provision: (args) => {
      calls.push("provision");
      provisioned.push(args);
      return Promise.resolve({ error: options.provisionError });
    },
    deleteUser: () => {
      calls.push("deleteUser");
      return Promise.resolve();
    },
  };

  return { deps, calls, provisioned };
}

function request(
  body: unknown,
  { auth = true, origin }: { auth?: boolean; origin?: string } = {},
): Request {
  return new Request("http://localhost/invite-member", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: "Bearer token" } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** Run `fn` with ALLOWED_ORIGINS set, restoring the previous value (or unset) after. */
async function withAllowedOrigins(value: string | undefined, fn: () => Promise<void>) {
  const previous = Deno.env.get("ALLOWED_ORIGINS");
  try {
    if (value === undefined) Deno.env.delete("ALLOWED_ORIGINS");
    else Deno.env.set("ALLOWED_ORIGINS", value);
    await fn();
  } finally {
    if (previous === undefined) Deno.env.delete("ALLOWED_ORIGINS");
    else Deno.env.set("ALLOWED_ORIGINS", previous);
  }
}

const validBody = { email: "nou@osubb.local", full_name: "Membru Nou" };

// ==================== the three regressions ====================

Deno.test("re-inviting an existing member never reaches Auth (would have deleted them)", async () => {
  const { deps, calls } = fakeDeps({ profileExists: true });

  const res = await handleInvite(request(validBody), deps);
  const payload = await res.json();

  assertEquals(res.status, 409);
  assertEquals(payload.code, "already_exists");
  // The whole point: inviteUserByEmail returns the EXISTING user rather than
  // failing, so provisioning would hit the primary key and the compensation
  // would delete a real member. Never call it.
  assertEquals(calls.includes("inviteByEmail"), false);
  assertEquals(calls.includes("deleteUser"), false);
});

Deno.test("a duplicate detected during provisioning must not delete the auth user", async () => {
  const { deps, calls } = fakeDeps({
    provisionError: { code: "23505", message: "duplicate key value violates unique constraint" },
  });

  const res = await handleInvite(request(validBody), deps);

  assertEquals(res.status, 409);
  // Someone else won the race; their profile is the real one. Deleting the
  // auth user here is what destroyed a member.
  assertEquals(calls.includes("deleteUser"), false);
});

Deno.test("unknown department fails before any invitation is emailed", async () => {
  const { deps, calls } = fakeDeps({ missing: { departments: ["inexistent"] } });

  const res = await handleInvite(
    request({ ...validBody, dept_ids: ["edu", "inexistent"] }),
    deps,
  );
  const payload = await res.json();

  assertEquals(res.status, 400);
  assertEquals(payload.error.includes("inexistent"), true);
  // A typo must never mail a real person an account we then delete.
  assertEquals(calls.includes("inviteByEmail"), false);
});

// ==================== authorization ====================

Deno.test("no Authorization header is refused", async () => {
  const { deps, calls } = fakeDeps();
  const res = await handleInvite(request(validBody, { auth: false }), deps);
  assertEquals(res.status, 401);
  assertEquals(calls.length, 0);
});

Deno.test("an invalid session is refused", async () => {
  const { deps } = fakeDeps({ callerId: null });
  const res = await handleInvite(request(validBody), deps);
  assertEquals(res.status, 401);
});

Deno.test("below level 6 is refused, and reads the level from the database", async () => {
  const { deps, calls } = fakeDeps({ level: 5 });
  const res = await handleInvite(request(validBody), deps);
  assertEquals(res.status, 403);
  assertEquals(calls.includes("memberLevel"), true);
  assertEquals(calls.includes("inviteByEmail"), false);
});

// ==================== input ====================

Deno.test("malformed JSON is refused", async () => {
  const { deps } = fakeDeps();
  const res = await handleInvite(request("{not json"), deps);
  assertEquals(res.status, 400);
});

Deno.test("email and name are required", async () => {
  const { deps } = fakeDeps();
  assertEquals((await handleInvite(request({ full_name: "X" }), deps)).status, 400);
  assertEquals((await handleInvite(request({ email: "a@b.c" }), deps)).status, 400);
});

// ==================== the happy path ====================

Deno.test("a BC invites, and the email is normalised once", async () => {
  const { deps, calls, provisioned } = fakeDeps();

  const res = await handleInvite(
    request({
      email: "  Ioana.Noua@Osubb.Local ",
      full_name: "  Ioana Nouă  ",
      role: "voluntar",
      dept_ids: ["edu"],
    }),
    deps,
  );
  const payload = await res.json();

  assertEquals(res.status, 201);
  assertEquals(payload.user_id, "new-user-1");
  // Lower-cased and trimmed at the single entry point, because Supabase links
  // Google identities by email (ADR-0003).
  assertEquals(payload.email, "ioana.noua@osubb.local");
  assertEquals(provisioned[0].email, "ioana.noua@osubb.local");
  assertEquals(provisioned[0].fullName, "Ioana Nouă");
  assertEquals(provisioned[0].role, "voluntar");
  assertEquals(provisioned[0].deptIds, ["edu"]);
  assertEquals(calls.includes("deleteUser"), false);
});

Deno.test("role defaults to recrut", async () => {
  const { deps, provisioned } = fakeDeps();
  await handleInvite(request(validBody), deps);
  assertEquals(provisioned[0].role, "recrut");
});

Deno.test("bad member data rolls the invitation back", async () => {
  const { deps, calls } = fakeDeps({
    provisionError: { code: "23503", message: "violates foreign key constraint" },
  });

  const res = await handleInvite(request(validBody), deps);

  assertEquals(res.status, 400);
  // Nothing to log into, so the account must not linger and burn the address.
  assertEquals(calls.includes("deleteUser"), true);
});

// ==================== CORS allow-list (#378) ====================

Deno.test("an allowed origin is echoed back with Vary: Origin", async () => {
  await withAllowedOrigins("http://localhost:5173", async () => {
    const { deps } = fakeDeps();
    const res = await handleInvite(request(validBody, { origin: "http://localhost:5173" }), deps);
    assertEquals(res.headers.get("Access-Control-Allow-Origin"), "http://localhost:5173");
    assertEquals(res.headers.get("Vary"), "Origin");
  });
});

Deno.test("an unlisted origin gets no Access-Control-Allow-Origin header", async () => {
  await withAllowedOrigins("http://localhost:5173", async () => {
    const { deps } = fakeDeps();
    const res = await handleInvite(request(validBody, { origin: "https://evil.example" }), deps);
    assertEquals(res.headers.has("Access-Control-Allow-Origin"), false);
    assertEquals(res.headers.get("Vary"), "Origin");
  });
});

Deno.test("preflight from an unlisted origin is refused with 403 and no ACAO", async () => {
  await withAllowedOrigins("http://localhost:5173", async () => {
    const { deps } = fakeDeps();
    const res = await handleInvite(
      new Request("http://localhost/invite-member", {
        method: "OPTIONS",
        headers: { Origin: "https://evil.example" },
      }),
      deps,
    );
    assertEquals(res.status, 403);
    assertEquals(res.headers.has("Access-Control-Allow-Origin"), false);
    assertEquals(res.headers.get("Vary"), "Origin");
  });
});

Deno.test("preflight from an allowed origin succeeds with the origin echoed", async () => {
  await withAllowedOrigins("http://localhost:5173", async () => {
    const { deps } = fakeDeps();
    const res = await handleInvite(
      new Request("http://localhost/invite-member", {
        method: "OPTIONS",
        headers: { Origin: "http://localhost:5173" },
      }),
      deps,
    );
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Access-Control-Allow-Origin"), "http://localhost:5173");
    assertEquals(res.headers.get("Vary"), "Origin");
  });
});

Deno.test("ALLOWED_ORIGINS parses a comma-separated list and trims whitespace", async () => {
  await withAllowedOrigins("https://a.example, https://b.example", async () => {
    const { deps: depsA } = fakeDeps();
    const resA = await handleInvite(request(validBody, { origin: "https://a.example" }), depsA);
    assertEquals(resA.headers.get("Access-Control-Allow-Origin"), "https://a.example");
    assertEquals(resA.headers.get("Vary"), "Origin");

    const { deps: depsB } = fakeDeps();
    const resB = await handleInvite(request(validBody, { origin: "https://b.example" }), depsB);
    assertEquals(resB.headers.get("Access-Control-Allow-Origin"), "https://b.example");
    assertEquals(resB.headers.get("Vary"), "Origin");
  });
});

Deno.test("the default origin applies when ALLOWED_ORIGINS is unset", async () => {
  await withAllowedOrigins(undefined, async () => {
    const { deps } = fakeDeps();
    const res = await handleInvite(request(validBody, { origin: "http://localhost:5173" }), deps);
    assertEquals(res.headers.get("Access-Control-Allow-Origin"), "http://localhost:5173");
    assertEquals(res.headers.get("Vary"), "Origin");
  });
});

Deno.test("a request with no Origin header gets Vary: Origin and no ACAO", async () => {
  const { deps } = fakeDeps();
  const res = await handleInvite(request(validBody), deps);
  assertEquals(res.headers.get("Vary"), "Origin");
  assertEquals(res.headers.has("Access-Control-Allow-Origin"), false);
});
