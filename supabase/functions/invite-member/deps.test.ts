// Tests for the real wiring of invite-member and csv-import (#796): the admin
// client is built from the project's secret key, never from the legacy
// service_role key, and without a secret key the function does not start.

import { assertEquals, assertThrows } from "@std/assert";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MissingSecretKeyError } from "../_shared/secret-keys.ts";
import { type ClientFactory, readAdminEnv, realDeps } from "./deps.ts";

// Made-up values in the real shapes; never real keys.
const SECRET = "sb_secret_test0000000000000000000000000000";
const ANON = "eyJhbGciOiJIUzI1NiJ9.anon.sig";
const URL = "http://127.0.0.1:54321";

/** A fake environment that records every variable name asked for. */
function environment(values: Record<string, string>) {
  const read: string[] = [];
  const get = (name: string): string | undefined => {
    read.push(name);
    return values[name];
  };
  return { get, read };
}

Deno.test("the admin client is built from the secret key, the caller client from the anon key", () => {
  const { get, read } = environment({
    SUPABASE_URL: URL,
    SUPABASE_ANON_KEY: ANON,
    SUPABASE_SECRET_KEYS: `{"default":"${SECRET}"}`,
  });
  const env = readAdminEnv("invite-member", get);
  assertEquals(env, { url: URL, anonKey: ANON, secretKey: SECRET });
  // Exactly these three: no fallback to the legacy service_role variable.
  assertEquals(read.sort(), [
    "SUPABASE_ANON_KEY",
    "SUPABASE_SECRET_KEYS",
    "SUPABASE_URL",
  ]);

  const built: { url: string; key: string; options: unknown }[] = [];
  const create: ClientFactory = (url, key, options) => {
    built.push({ url, key, options });
    return {} as SupabaseClient;
  };
  const request = new Request("http://localhost/invite-member", {
    method: "POST",
    headers: { Authorization: "Bearer caller-token" },
  });
  realDeps(request, env, create);

  assertEquals(built, [
    {
      url: URL,
      key: ANON,
      options: {
        global: { headers: { Authorization: "Bearer caller-token" } },
      },
    },
    {
      url: URL,
      key: SECRET,
      options: { auth: { autoRefreshToken: false, persistSession: false } },
    },
  ]);
});

Deno.test("with no secret key the function refuses to start, naming the setting", () => {
  for (const name of ["invite-member", "csv-import"]) {
    const { get } = environment({ SUPABASE_URL: URL, SUPABASE_ANON_KEY: ANON });
    const error = assertThrows(
      () => readAdminEnv(name, get),
      MissingSecretKeyError,
    );
    assertEquals(error.message.startsWith(`${name} cannot start`), true);
    assertEquals(error.message.includes("SUPABASE_SECRET_KEYS"), true);
  }
});

Deno.test("with no project URL or anon key the function refuses to start, naming the variable", () => {
  const secretKeys = `{"default":"${SECRET}"}`;
  for (
    const [missing, values] of [
      ["SUPABASE_URL", { SUPABASE_ANON_KEY: ANON }],
      ["SUPABASE_ANON_KEY", { SUPABASE_URL: URL }],
    ] as const
  ) {
    const { get } = environment({
      ...values,
      SUPABASE_SECRET_KEYS: secretKeys,
    });
    const error = assertThrows(() => readAdminEnv("invite-member", get));
    assertEquals(
      (error as Error).message,
      `invite-member cannot start: ${missing} is not set.`,
    );
  }
});
