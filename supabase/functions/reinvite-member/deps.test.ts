// Tests for the real wiring of reinvite-member (#773): the handler run end to
// end against fake Supabase clients, so what reaches the Auth admin API and
// the tables is observed exactly as it would be sent.

import { assertEquals } from "@std/assert";
import type { SupabaseClient } from "@supabase/supabase-js";
import { handleReinvite } from "./handler.ts";
import { type AdminEnv, type ClientFactory, realDeps } from "./deps.ts";

const MEMBER = "11111111-2222-4333-8444-555555555555";
// The fake clients ignore the keys; placeholders, never real ones.
const ENV: AdminEnv = {
  url: "http://127.0.0.1:54321",
  anonKey: "anon",
  secretKey: "secret",
};

type Result = { data: unknown; error: unknown };

interface World {
  lastSignInAt: string | null;
  profileUpdateError?: { code: string; message: string };
}

/**
 * Two fake clients sharing one log. Every Auth admin method a careless edit
 * could reach is present — deleteUser and createUser included — so the log
 * proves they were not called rather than that they could not be.
 */
function fakeClients(world: World) {
  const log: string[] = [];

  function query(table: string) {
    const steps: string[] = [];
    const builder = {
      select(columns: string) {
        steps.push(`select(${columns})`);
        return builder;
      },
      ilike(column: string, value: unknown) {
        steps.push(`ilike(${column},${value})`);
        return builder;
      },
      eq(column: string, value: unknown) {
        steps.push(`eq(${column},${value})`);
        return builder;
      },
      neq(column: string, value: unknown) {
        steps.push(`neq(${column},${value})`);
        return builder;
      },
      limit(count: number) {
        steps.push(`limit(${count})`);
        return builder;
      },
      update(values: Record<string, unknown>) {
        steps.push(`update(${JSON.stringify(values)})`);
        return builder;
      },
      insert(values: Record<string, unknown>) {
        steps.push(`insert(${JSON.stringify(values)})`);
        return builder;
      },
      maybeSingle: () => settle(),
      single: () => settle(),
      then(resolve: (value: Result) => unknown, reject?: () => unknown) {
        return settle().then(resolve, reject);
      },
    };
    function settle(): Promise<Result> {
      log.push(`${table}.${steps.join(".")}`);
      if (table === "profiles" && steps[0]?.startsWith("update")) {
        return Promise.resolve(
          world.profileUpdateError
            ? { data: null, error: world.profileUpdateError }
            : { data: { id: MEMBER }, error: null },
        );
      }
      if (table === "profiles" && steps.some((s) => s.startsWith("neq"))) {
        return Promise.resolve({ data: [], error: null });
      }
      if (table === "profiles") {
        return Promise.resolve({
          data: {
            email: "gresit@osubb.local",
            full_name: "Ioana Popescu",
            status: "activ",
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    }
    return builder;
  }

  const record = (name: string, result: Result) => (...args: unknown[]) => {
    log.push(`auth.admin.${name}(${args.map((a) => JSON.stringify(a))})`);
    return Promise.resolve(result);
  };

  const caller = {
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: { id: "caller-1" } }, error: null }),
    },
  };
  const admin = {
    rpc: (name: string) => {
      log.push(`rpc.${name}`);
      return Promise.resolve({ data: 6, error: null });
    },
    from: (table: string) => query(table),
    auth: {
      admin: {
        getUserById: (id: string) => {
          log.push(`auth.admin.getUserById("${id}")`);
          return Promise.resolve({
            data: {
              user: {
                id,
                email: "gresit@osubb.local",
                last_sign_in_at: world.lastSignInAt,
                email_confirmed_at: null,
              },
            },
            error: null,
          });
        },
        updateUserById: record("updateUserById", {
          data: { user: { id: MEMBER } },
          error: null,
        }),
        inviteUserByEmail: record("inviteUserByEmail", {
          data: { user: { id: MEMBER } },
          error: null,
        }),
        deleteUser: record("deleteUser", { data: null, error: null }),
        createUser: record("createUser", { data: null, error: null }),
        generateLink: record("generateLink", { data: null, error: null }),
      },
    },
  };

  let built = 0;
  const create: ClientFactory = () =>
    (built++ === 0 ? caller : admin) as unknown as SupabaseClient;
  return { create, log };
}

function request(body: unknown): Request {
  return new Request("http://localhost/reinvite-member", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer caller-token",
    },
    body: JSON.stringify(body),
  });
}

const authAdminWrites = (log: string[]) =>
  log.filter((line) =>
    line.startsWith("auth.admin.") && !line.startsWith("auth.admin.getUserById")
  );

Deno.test("a correction reaches Auth and profiles, then the same user is invited — never deleted", async () => {
  const { create, log } = fakeClients({ lastSignInAt: null });
  const req = request({ member_id: MEMBER, email: "corect@osubb.local" });

  const res = await handleReinvite(req, realDeps(req, ENV, create));

  assertEquals(res.status, 200);
  assertEquals(authAdminWrites(log), [
    `auth.admin.updateUserById("${MEMBER}",{"email":"corect@osubb.local"})`,
    `auth.admin.inviteUserByEmail("corect@osubb.local")`,
  ]);
  assertEquals(
    log.includes(
      `profiles.update({"email":"corect@osubb.local"}).eq(id,${MEMBER}).select(id)`,
    ),
    true,
  );
  assertEquals(
    log.at(-1),
    `notifications.insert(${
      JSON.stringify({
        member_id: "caller-1",
        kind: "system",
        title: "Invitație retrimisă",
        body:
          "Invitația pentru Ioana Popescu a fost retrimisă la corect@osubb.local. Adresa anterioară: gresit@osubb.local.",
        link: `/administrare/membri/${MEMBER}`,
      })
    })`,
  );
});

Deno.test("a profile failure rolls Auth back without deleting the user", async () => {
  const { create, log } = fakeClients({
    lastSignInAt: null,
    profileUpdateError: { code: "XX000", message: "boom" },
  });
  const req = request({ member_id: MEMBER, email: "corect@osubb.local" });

  const res = await handleReinvite(req, realDeps(req, ENV, create));

  assertEquals(res.status, 500);
  assertEquals(authAdminWrites(log), [
    `auth.admin.updateUserById("${MEMBER}",{"email":"corect@osubb.local"})`,
    `auth.admin.updateUserById("${MEMBER}",{"email":"gresit@osubb.local"})`,
  ]);
});

Deno.test("a signed-in Member reaches no Auth write at all", async () => {
  const { create, log } = fakeClients({ lastSignInAt: "2026-09-20T10:00:00Z" });
  const req = request({ member_id: MEMBER, email: "corect@osubb.local" });

  const res = await handleReinvite(req, realDeps(req, ENV, create));

  assertEquals(res.status, 409);
  assertEquals(authAdminWrites(log), []);
  assertEquals(log.some((line) => line.includes(".update(")), false);
});
