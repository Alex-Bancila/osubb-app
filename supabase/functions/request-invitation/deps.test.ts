// Tests for the real wiring of request-invitation (#968): the handler run end
// to end against a fake Supabase admin client, so what reaches the database
// and the Auth admin API is observed exactly as it would be sent.

import { assertEquals, assertRejects } from "@std/assert";
import type { SupabaseClient } from "@supabase/supabase-js";
import { handleRequestInvitation } from "./handler.ts";
import { type AdminEnv, type ClientFactory, realDeps } from "./deps.ts";
import { capturingErrors } from "../_shared/test-logs.ts";

// The fake client ignores the keys; placeholders, never real ones.
const ENV: AdminEnv = {
  url: "http://127.0.0.1:54321",
  anonKey: "anon",
  secretKey: "secret",
};

type Result = { data: unknown; error: unknown };

interface World {
  verdict?: unknown;
  rpcError?: { code: string; message: string };
  inviteError?: { message: string; status: number };
}

/**
 * One fake admin client with one log. Every Auth admin method a careless edit
 * could reach is present — deleteUser, createUser and generateLink included —
 * so the log proves they were not called rather than that they could not be.
 */
function fakeClients(world: World) {
  const log: string[] = [];
  const keys: string[] = [];

  const record = (name: string, result: Result) => (...args: unknown[]) => {
    log.push(`auth.admin.${name}(${args.map((a) => JSON.stringify(a))})`);
    return Promise.resolve(result);
  };

  const admin = {
    rpc: (name: string, args: unknown) => {
      log.push(`rpc.${name}(${JSON.stringify(args)})`);
      return Promise.resolve(
        world.rpcError
          ? { data: null, error: world.rpcError }
          : { data: "verdict" in world ? world.verdict : "send", error: null },
      );
    },
    from: (table: string) => {
      log.push(`from(${table})`);
      throw new Error("request-invitation reads no table");
    },
    auth: {
      admin: {
        inviteUserByEmail: (...args: unknown[]) =>
          record("inviteUserByEmail", {
            data: world.inviteError ? { user: null } : { user: { id: "u-1" } },
            error: world.inviteError ?? null,
          })(...args),
        deleteUser: record("deleteUser", { data: null, error: null }),
        createUser: record("createUser", { data: null, error: null }),
        generateLink: record("generateLink", { data: null, error: null }),
        updateUserById: record("updateUserById", { data: null, error: null }),
      },
    },
  };

  const create: ClientFactory = (_url, key) => {
    keys.push(key);
    return admin as unknown as SupabaseClient;
  };
  return { create, log, keys };
}

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/request-invitation", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:5173",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

Deno.test("the admin client is built from the secret key, never the anon key", () => {
  const { create, keys } = fakeClients({});
  realDeps(ENV, create);
  assertEquals(keys, ["secret"]);
});

Deno.test("'send' asks the database with the address and the IP hash, then re-invites that address — nothing else", async () => {
  const { create, log } = fakeClients({ verdict: "send" });
  const deps = realDeps(ENV, create);

  const res = await handleRequestInvitation(
    request({ email: " Ana@Exemplu.ro" }, { "x-real-ip": "192.0.2.9" }),
    deps,
  );

  assertEquals(res.status, 202);
  assertEquals(log.length, 2);
  const [rpc, invite] = log;
  const args = JSON.parse(
    rpc.slice("rpc.request_invitation_allowed(".length, -1),
  );
  assertEquals(Object.keys(args).sort(), ["p_email", "p_ip_hash"]);
  assertEquals(args.p_email, "ana@exemplu.ro");
  assertEquals(/^[0-9a-f]{32}$/.test(args.p_ip_hash), true);
  // Exactly reinvite-member's call: the address alone, no options, so the
  // existing unconfirmed user gets a new token and nothing is created.
  assertEquals(invite, `auth.admin.inviteUserByEmail("ana@exemplu.ro")`);
});

Deno.test("no IP header reaches the database as a null IP hash", async () => {
  const { create, log } = fakeClients({ verdict: "skip" });

  await handleRequestInvitation(
    request({ email: "ana@exemplu.ro" }),
    realDeps(ENV, create),
  );

  assertEquals(log, [
    `rpc.request_invitation_allowed({"p_email":"ana@exemplu.ro","p_ip_hash":null})`,
  ]);
});

for (const verdict of ["skip", "cooldown", "ip_limited"]) {
  Deno.test(`'${verdict}' reaches no Auth admin method at all`, async () => {
    const { create, log } = fakeClients({ verdict });

    await handleRequestInvitation(
      request({ email: "ana@exemplu.ro" }),
      realDeps(ENV, create),
    );

    assertEquals(log.filter((line) => line.startsWith("auth.admin.")), []);
  });
}

Deno.test("an Auth refusal to re-send is a throw the handler logs and answers 202", async () => {
  const { create, log } = fakeClients({
    verdict: "send",
    inviteError: { message: "Error sending invite email", status: 500 },
  });
  const deps = realDeps(ENV, create);

  await assertRejects(() => deps.inviteByEmail("ana@exemplu.ro"));

  const { result: res } = await capturingErrors(() =>
    handleRequestInvitation(request({ email: "ana@exemplu.ro" }), deps)
  );
  assertEquals(res.status, 202);
  assertEquals(
    log.filter((line) => line.startsWith("auth.admin.")),
    [
      `auth.admin.inviteUserByEmail("ana@exemplu.ro")`,
      `auth.admin.inviteUserByEmail("ana@exemplu.ro")`,
    ],
  );
});

Deno.test("a database error, or an answer outside the four verdicts, throws", async () => {
  const failing = realDeps(
    ENV,
    fakeClients({ rpcError: { code: "PT400", message: "email_required" } })
      .create,
  );
  await assertRejects(() => failing.verdict("ana@exemplu.ro", null));

  for (const answer of ["yes", null, 1]) {
    const odd = realDeps(ENV, fakeClients({ verdict: answer }).create);
    // A verdict the function does not know is a deploy mismatch, never a send.
    await assertRejects(() => odd.verdict("ana@exemplu.ro", null));
  }
});
