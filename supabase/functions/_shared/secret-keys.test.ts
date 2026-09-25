// Tests for the shared secret-key helpers (#769, #796).

import { assertEquals, assertThrows } from "@std/assert";
import {
  constantTimeEqual,
  isSecretKey,
  MissingSecretKeyError,
  parseSecretKeys,
  requireSecretKey,
} from "./secret-keys.ts";

// A made-up key in the sb_secret_ shape; never a real one.
const SECRET = "sb_secret_test0000000000000000000000000000";

Deno.test("constantTimeEqual and isSecretKey compare whole strings", () => {
  assertEquals(constantTimeEqual("abc", "abc"), true);
  assertEquals(constantTimeEqual("abc", "abd"), false);
  assertEquals(constantTimeEqual("abc", "ab"), false);
  assertEquals(constantTimeEqual("", ""), true);
  assertEquals(constantTimeEqual("ă", "a"), false);
  assertEquals(isSecretKey(null, [SECRET]), false);
  assertEquals(isSecretKey("", [""]), false);
  assertEquals(isSecretKey(SECRET, [SECRET]), true);
});

Deno.test("parseSecretKeys reads the platform's JSON map, default first", () => {
  assertEquals(parseSecretKeys(undefined), []);
  assertEquals(parseSecretKeys(""), []);
  assertEquals(parseSecretKeys("sb_secret_plain"), []);
  assertEquals(parseSecretKeys('["sb_secret_a"]'), []);
  assertEquals(parseSecretKeys('{"default":""}'), []);
  assertEquals(
    parseSecretKeys('{"ci":"sb_secret_ci","default":"sb_secret_d","n":1}'),
    ["sb_secret_d", "sb_secret_ci"],
  );
});

Deno.test("requireSecretKey answers the default key, else the first one", () => {
  assertEquals(
    requireSecretKey('{"ci":"sb_secret_ci","default":"sb_secret_d"}', "f"),
    "sb_secret_d",
  );
  assertEquals(requireSecretKey('{"ci":"sb_secret_ci"}', "f"), "sb_secret_ci");
});

Deno.test("requireSecretKey refuses, naming the function and the fix, when there is no key", () => {
  for (const raw of [undefined, "", "{}", '{"default":""}', "not json"]) {
    const error = assertThrows(
      () => requireSecretKey(raw, "invite-member"),
      MissingSecretKeyError,
    );
    assertEquals(error.message.startsWith("invite-member cannot start"), true);
    assertEquals(error.message.includes("SUPABASE_SECRET_KEYS"), true);
    assertEquals(error.message.includes("Project Settings → API Keys"), true);
  }
});
