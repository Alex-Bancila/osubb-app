// Security pass 2026-09-27, L4: an Edge Function's error body carries a
// stable reason `code` and a fixed message, and nothing else. This sweep
// drives every handler down its error paths with dependencies that fail
// loudly -- database errors in PostgREST's words, missing settings by name --
// and fails if any of that reaches a body. The details belong in the
// function log (console.error), which only the project's owners can read.
//
// Adding an error path to a handler? Add a case here.

import { assert, assertEquals } from "@std/assert";
import { handleCsvImport } from "../csv-import/handler.ts";
import type { CsvImportDeps } from "../csv-import/handler.ts";
import { handleInvite } from "../invite-member/handler.ts";
import type { InviteDeps } from "../invite-member/deps.ts";
import { handleReinvite } from "../reinvite-member/handler.ts";
import type { ReinviteDeps } from "../reinvite-member/deps.ts";
import { handleResendWebhook } from "../resend-webhook/handler.ts";
import type { ResendWebhookDeps } from "../resend-webhook/deps.ts";
import { decodeSigningSecret, sign } from "../resend-webhook/signature.ts";
import { handleSendPush } from "../send-push/handler.ts";
import type { SendPushDeps } from "../send-push/deps.ts";
import { capturingErrors } from "./test-logs.ts";

/** What a leaky handler would echo: PostgREST, Postgres and a setting name. */
const LEAK = "PGRST116: relation private.provision_secret violates check " +
  "constraint profiles_level_check (SQLSTATE 23514) near SUPABASE_SECRET_KEYS";

const ENV_NAMES = [
  "ALLOWED_ORIGINS",
  "RESEND_WEBHOOK_SECRET",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SECRET_KEYS",
  "SUPABASE_URL",
  "VAPID_PRIVATE_KEY",
  "VAPID_PUBLIC_KEY",
  "VAPID_SUBJECT",
];

/** Text that must never appear in an error body. */
const FORBIDDEN: RegExp[] = [
  ...ENV_NAMES.map((name) => new RegExp(name)),
  /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/, // any SCREAMING_SNAKE setting name
  /PGRST/i,
  /SQLSTATE/i,
  /\brelation\b/i,
  /\bviolates\b/i,
  /\bconstraint\b/i,
  /\b(public|private|auth)\.[a-z_]+/,
  /provision_secret|profiles_level_check/,
  /\bat .+\.ts:\d+/, // a stack frame
];

function assertClean(name: string, text: string) {
  for (const pattern of FORBIDDEN) {
    assert(!pattern.test(text), `${name}: body matches ${pattern}: ${text}`);
  }
}

async function assertHygienic(name: string, response: Response) {
  assert(response.status >= 400, `${name}: expected an error status`);
  const text = await response.text();
  assertClean(name, text);
  const body = JSON.parse(text);
  assertEquals(
    Object.keys(body).sort(),
    ["code", "error"],
    `${name}: body is not { code, error }: ${text}`,
  );
  assert(/^[a-z][a-z0-9_]*$/.test(body.code), `${name}: code ${body.code}`);
  assertEquals(typeof body.error, "string", name);
}

/** Runs one case with the log captured, so the sweep prints only failures. */
async function sweep(name: string, run: () => Promise<Response>) {
  const { result } = await capturingErrors(run);
  await assertHygienic(name, result);
}

const UUID = "00000000-0000-4000-8000-000000000001";
const reject = () => Promise.reject(new Error(LEAK));
const dbError = { code: "23514", message: LEAK, status: 500 };

function browserPost(url: string, body: unknown, auth = true): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: "Bearer token" } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// ==================== invite-member ====================

function inviteDeps(overrides: Partial<InviteDeps> = {}): InviteDeps {
  return {
    callerId: () => Promise.resolve("caller-1"),
    memberLevel: () => Promise.resolve(6),
    missingGroupIds: () => Promise.resolve([]),
    profileExists: () => Promise.resolve(false),
    inviteByEmail: () => Promise.resolve({ userId: "new-user-1" }),
    provision: () => Promise.resolve({}),
    deleteUser: () => Promise.resolve(),
    ...overrides,
  };
}

const INVITE = "http://localhost/invite-member";
const INVITE_BODY = { email: "ana@example.com", full_name: "Ana Pop" };

Deno.test("invite-member: no error body carries database or setting text", async () => {
  const cases: Array<[string, Request, InviteDeps]> = [
    ["GET", new Request(INVITE), inviteDeps()],
    ["no bearer", browserPost(INVITE, INVITE_BODY, false), inviteDeps()],
    [
      "invalid session",
      browserPost(INVITE, INVITE_BODY),
      inviteDeps({ callerId: () => Promise.resolve(null) }),
    ],
    [
      "level lookup fails",
      browserPost(INVITE, INVITE_BODY),
      inviteDeps({ memberLevel: reject }),
    ],
    [
      "below BC",
      browserPost(INVITE, INVITE_BODY),
      inviteDeps({ memberLevel: () => Promise.resolve(5) }),
    ],
    ["bad JSON", browserPost(INVITE, "{"), inviteDeps()],
    ["array body", browserPost(INVITE, []), inviteDeps()],
    ["legacy ids", browserPost(INVITE, { dept_ids: [1] }), inviteDeps()],
    ["typed fields", browserPost(INVITE, { email: 1 }), inviteDeps()],
    ["bad email", browserPost(INVITE, { full_name: "Ana" }), inviteDeps()],
    ["no name", browserPost(INVITE, { email: "a@b.ro" }), inviteDeps()],
    [
      "bad group ids",
      browserPost(INVITE, { ...INVITE_BODY, group_ids: "x" }),
      inviteDeps(),
    ],
    [
      "reserved role",
      browserPost(INVITE, { ...INVITE_BODY, role: "bc" }),
      inviteDeps(),
    ],
    [
      "missing group",
      browserPost(INVITE, { ...INVITE_BODY, group_ids: [999] }),
      inviteDeps({ missingGroupIds: () => Promise.resolve([999]) }),
    ],
    [
      "existing profile",
      browserPost(INVITE, INVITE_BODY),
      inviteDeps({ profileExists: () => Promise.resolve(true) }),
    ],
    [
      "Auth refuses the invite",
      browserPost(INVITE, INVITE_BODY),
      inviteDeps({ inviteByEmail: () => Promise.resolve({ error: dbError }) }),
    ],
    [
      "provisioning refused",
      browserPost(INVITE, INVITE_BODY),
      inviteDeps({ provision: () => Promise.resolve({ error: dbError }) }),
    ],
    [
      "unexpected throw",
      browserPost(INVITE, INVITE_BODY),
      inviteDeps({ profileExists: reject }),
    ],
  ];
  for (const [name, req, deps] of cases) {
    await sweep(`invite-member ${name}`, () => handleInvite(req, deps));
  }
});

// ==================== csv-import ====================

function csvDeps(overrides: Partial<CsvImportDeps> = {}): CsvImportDeps {
  return {
    callerId: () => Promise.resolve("caller-1"),
    memberLevel: () => Promise.resolve(6),
    activeGroups: () => Promise.resolve([]),
    invite: reject,
    ...overrides,
  };
}

const CSV = "http://localhost/csv-import";
const CSV_BODY = { csv: "name,email,dept,team\nAna Pop,ana@example.com,,\n" };

Deno.test("csv-import: no error body carries database or setting text", async () => {
  const cases: Array<[string, Request, CsvImportDeps]> = [
    ["GET", new Request(CSV), csvDeps()],
    [
      "not JSON",
      new Request(CSV, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "x",
      }),
      csvDeps(),
    ],
    ["no bearer", browserPost(CSV, CSV_BODY, false), csvDeps()],
    [
      "session lookup throws",
      browserPost(CSV, CSV_BODY),
      csvDeps({ callerId: reject }),
    ],
    [
      "invalid session",
      browserPost(CSV, CSV_BODY),
      csvDeps({ callerId: () => Promise.resolve(null) }),
    ],
    [
      "level lookup fails",
      browserPost(CSV, CSV_BODY),
      csvDeps({ memberLevel: reject }),
    ],
    [
      "below BC",
      browserPost(CSV, CSV_BODY),
      csvDeps({ memberLevel: () => Promise.resolve(5) }),
    ],
    ["bad JSON", browserPost(CSV, "{"), csvDeps()],
    ["no csv", browserPost(CSV, {}), csvDeps()],
    [
      "too large",
      browserPost(CSV, { csv: "a".repeat(256 * 1024 + 1) }),
      csvDeps(),
    ],
    [
      "groups fail to load",
      browserPost(CSV, CSV_BODY),
      csvDeps({ activeGroups: reject }),
    ],
    ["bad header", browserPost(CSV, { csv: "a,b\n1,2\n" }), csvDeps()],
  ];
  for (const [name, req, deps] of cases) {
    await sweep(`csv-import ${name}`, () => handleCsvImport(req, deps));
  }
});

Deno.test("csv-import: a failing row reports a code, never the database's words", async () => {
  for (
    const invite of [
      reject,
      () =>
        Promise.resolve({
          kind: "provision_failed" as const,
          details: LEAK,
          cause: dbError,
        }),
      () => Promise.resolve({ kind: "invite_failed" as const, cause: dbError }),
    ]
  ) {
    const { result } = await capturingErrors(() =>
      handleCsvImport(browserPost(CSV, CSV_BODY), csvDeps({ invite }))
    );
    assertEquals(result.status, 200);
    const report = await result.json();
    assertEquals(report.summary.errors, 1);
    assertClean("csv-import row report", JSON.stringify(report));
  }
});

// ==================== reinvite-member ====================

function reinviteDeps(overrides: Partial<ReinviteDeps> = {}): ReinviteDeps {
  return {
    callerId: () => Promise.resolve("caller-1"),
    memberLevel: () => Promise.resolve(6),
    authAccount: () =>
      Promise.resolve({
        email: "old@example.com",
        lastSignInAt: null,
        emailConfirmed: false,
      }),
    profile: () =>
      Promise.resolve({
        email: "old@example.com",
        fullName: "Ana Pop",
        status: "activ",
        role: "membru",
      }),
    emailTaken: () => Promise.resolve(false),
    setAuthEmail: () => Promise.resolve({}),
    setProfileEmail: () => Promise.resolve({}),
    inviteByEmail: () => Promise.resolve({ userId: UUID }),
    notifyCaller: () => Promise.resolve(),
    ...overrides,
  };
}

const REINVITE = "http://localhost/reinvite-member";
const MOVE = { member_id: UUID, email: "new@example.com" };

Deno.test("reinvite-member: no error body carries database or setting text", async () => {
  const cases: Array<[string, Request, ReinviteDeps]> = [
    ["GET", new Request(REINVITE), reinviteDeps()],
    ["no bearer", browserPost(REINVITE, MOVE, false), reinviteDeps()],
    [
      "invalid session",
      browserPost(REINVITE, MOVE),
      reinviteDeps({ callerId: () => Promise.resolve(null) }),
    ],
    [
      "level lookup fails",
      browserPost(REINVITE, MOVE),
      reinviteDeps({ memberLevel: reject }),
    ],
    [
      "below BC",
      browserPost(REINVITE, MOVE),
      reinviteDeps({ memberLevel: () => Promise.resolve(5) }),
    ],
    ["bad JSON", browserPost(REINVITE, "{"), reinviteDeps()],
    ["array body", browserPost(REINVITE, []), reinviteDeps()],
    [
      "bad action",
      browserPost(REINVITE, { ...MOVE, action: "x" }),
      reinviteDeps(),
    ],
    ["bad id", browserPost(REINVITE, { member_id: "x" }), reinviteDeps()],
    [
      "typed email",
      browserPost(REINVITE, { member_id: UUID, email: 1 }),
      reinviteDeps(),
    ],
    [
      "no such Member",
      browserPost(REINVITE, MOVE),
      reinviteDeps({ profile: () => Promise.resolve(null) }),
    ],
    [
      "Auth refuses the address",
      browserPost(REINVITE, MOVE),
      reinviteDeps({ setAuthEmail: () => Promise.resolve({ error: dbError }) }),
    ],
    [
      "profile refuses, rollback fails",
      browserPost(REINVITE, MOVE),
      reinviteDeps({
        setAuthEmail: (_id, email) =>
          Promise.resolve(
            email === "old@example.com" ? { error: dbError } : {},
          ),
        setProfileEmail: () => Promise.resolve({ error: dbError }),
      }),
    ],
    [
      "profile refuses",
      browserPost(REINVITE, MOVE),
      reinviteDeps({
        setProfileEmail: () => Promise.resolve({ error: dbError }),
      }),
    ],
    [
      "send fails",
      browserPost(REINVITE, MOVE),
      reinviteDeps({
        inviteByEmail: () => Promise.resolve({ error: dbError }),
      }),
    ],
    [
      "unexpected throw",
      browserPost(REINVITE, MOVE),
      reinviteDeps({ emailTaken: reject }),
    ],
  ];
  for (const [name, req, deps] of cases) {
    await sweep(`reinvite-member ${name}`, () => handleReinvite(req, deps));
  }
});

// ==================== send-push ====================

const SECRET = "sb_secret_made_up_for_tests";

function pushDeps(overrides: Partial<SendPushDeps> = {}): SendPushDeps {
  return {
    secretKeys: () => [SECRET],
    configProblems: () => [],
    appOrigin: () => null,
    claim: reject,
    settle: () => Promise.resolve("sent"),
    send: () => Promise.resolve({ status: 201, body: "" }),
    ...overrides,
  };
}

function pushPost(apikey: string | null = SECRET): Request {
  return new Request("http://localhost/send-push", {
    method: "POST",
    headers: apikey ? { apikey } : {},
  });
}

Deno.test("send-push: no error body carries database or setting text", async () => {
  const cases: Array<[string, Request, SendPushDeps]> = [
    [
      "GET",
      new Request("http://localhost/send-push", {
        headers: { apikey: SECRET },
      }),
      pushDeps(),
    ],
    [
      "no secret key configured",
      pushPost(),
      pushDeps({ secretKeys: () => [] }),
    ],
    ["wrong key", pushPost("sb_secret_wrong"), pushDeps()],
    [
      "missing VAPID settings",
      pushPost(),
      pushDeps({
        configProblems: () => ["VAPID_PRIVATE_KEY", "VAPID_SUBJECT"],
      }),
    ],
    ["claim fails", pushPost(), pushDeps()],
  ];
  for (const [name, req, deps] of cases) {
    await sweep(`send-push ${name}`, () => handleSendPush(req, deps));
  }
});

// ==================== resend-webhook ====================

const SIGNING_SECRET = `whsec_${btoa("made-up signing secret, not a real")}`;
const NOW = 1_790_000_000;
const BOUNCE = JSON.stringify({
  type: "email.bounced",
  data: { to: ["ana@example.com"], bounce: { type: "Permanent" } },
});

function webhookDeps(
  overrides: Partial<ResendWebhookDeps> = {},
): ResendWebhookDeps {
  return {
    signingSecret: () => SIGNING_SECRET,
    hasSecretKey: () => true,
    nowSeconds: () => NOW,
    notify: reject,
    ...overrides,
  };
}

async function webhookPost(
  body: string,
  { valid = true }: { valid?: boolean } = {},
): Promise<Request> {
  const key = decodeSigningSecret(SIGNING_SECRET)!;
  const id = "msg_sweep";
  const timestamp = String(NOW);
  const signature = valid
    ? `v1,${await sign(key, id, timestamp, body)}`
    : "v1,AAAA";
  return new Request("http://localhost/resend-webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": signature,
    },
    body,
  });
}

Deno.test("resend-webhook: no error body carries database or setting text", async () => {
  const cases: Array<[string, () => Promise<Request>, ResendWebhookDeps]> = [
    [
      "GET",
      () => Promise.resolve(new Request("http://localhost/resend-webhook")),
      webhookDeps(),
    ],
    [
      "no signing secret",
      () => webhookPost(BOUNCE),
      webhookDeps({ signingSecret: () => "" }),
    ],
    [
      "no project secret key",
      () => webhookPost(BOUNCE),
      webhookDeps({ hasSecretKey: () => false }),
    ],
    [
      "body too large",
      () => webhookPost("x".repeat(64 * 1024 + 1)),
      webhookDeps(),
    ],
    ["forged", () => webhookPost(BOUNCE, { valid: false }), webhookDeps()],
    ["not JSON", () => webhookPost("{"), webhookDeps()],
    ["not an object", () => webhookPost("1"), webhookDeps()],
    [
      "no data",
      () => webhookPost(JSON.stringify({ type: "email.bounced" })),
      webhookDeps(),
    ],
    ["database fails", () => webhookPost(BOUNCE), webhookDeps()],
  ];
  for (const [name, request, deps] of cases) {
    const req = await request();
    await sweep(`resend-webhook ${name}`, () => handleResendWebhook(req, deps));
  }
});
