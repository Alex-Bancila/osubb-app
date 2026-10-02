import { assertEquals } from "@std/assert";
import type { AuthAccount, MemberProfile } from "../reinvite-member/deps.ts";
import type { AuthError } from "../reinvite-member/deps.ts";
import type { SendError, SendInvitationsDeps } from "./deps.ts";
import {
  BATCH_LIMIT,
  handleSendInvitations,
  TIME_BUDGET_MS,
} from "./handler.ts";

const id = (n: number) =>
  `99100000-0000-4000-8000-${String(n).padStart(12, "0")}`;

interface FakeOptions {
  level?: number;
  accounts?: Record<string, Partial<AuthAccount> | null>;
  profiles?: Record<string, Partial<MemberProfile> | null>;
  /** The Nth send (1-based) answers this error. */
  sendErrors?: Record<number, SendError>;
  stampError?: Error;
  /** Milliseconds added to the clock per send. */
  sendCost?: number;
  /** Addresses another profile already holds. */
  takenEmails?: string[];
  /** What Auth answers when the address is moved. */
  setAuthError?: AuthError;
}

function fakeDeps(options: FakeOptions = {}) {
  const calls: string[] = [];
  let clock = 0;
  let sends = 0;
  const deps: SendInvitationsDeps = {
    callerId: () => Promise.resolve("caller-1"),
    memberLevel: () => Promise.resolve(options.level ?? 6),
    authAccount: (memberId) => {
      const account = options.accounts?.[memberId];
      return Promise.resolve(
        account === null ? null : {
          email: `${memberId.slice(-2)}@osubb.local`,
          lastSignInAt: null,
          emailConfirmed: false,
          ...account,
        },
      );
    },
    profile: (memberId) => {
      const profile = options.profiles?.[memberId];
      return Promise.resolve(
        profile === null ? null : {
          email: `${memberId.slice(-2)}@osubb.local`,
          fullName: "Voluntar",
          status: "activ",
          role: "voluntar",
          invitedAt: null,
          ...profile,
        },
      );
    },
    emailTaken: (email) => {
      calls.push(`taken?:${email}`);
      return Promise.resolve(options.takenEmails?.includes(email) ?? false);
    },
    setAuthEmail: (memberId, email) => {
      calls.push(`setAuthEmail:${memberId}:${email}`);
      return Promise.resolve(
        options.setAuthError ? { error: options.setAuthError } : {},
      );
    },
    inviteByEmail: (email) => {
      sends += 1;
      calls.push(`invite:${email}`);
      clock += options.sendCost ?? 0;
      const error = options.sendErrors?.[sends];
      if (error) return Promise.resolve({ error });
      const memberId = id(Number(email.slice(0, 2)));
      return Promise.resolve({ userId: memberId });
    },
    recordInvitationSent: (memberId) => {
      calls.push(`stamp:${memberId}`);
      return options.stampError
        ? Promise.reject(options.stampError)
        : Promise.resolve("2026-10-02T10:00:00+00:00");
    },
    now: () => clock,
  };
  return { deps, calls };
}

function request(body: unknown, { auth = true } = {}): Request {
  return new Request("http://localhost/send-invitations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: "Bearer token" } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

Deno.test("only BC or the Moderator may send invitations", async () => {
  const { deps, calls } = fakeDeps({ level: 5 });
  const res = await handleSendInvitations(
    request({ member_ids: [id(10)] }),
    deps,
  );
  assertEquals(res.status, 403);
  assertEquals((await res.json()).code, "member_manage_forbidden");
  assertEquals(calls, []);
});

Deno.test("an unsigned request is refused before anything is read", async () => {
  const { deps } = fakeDeps();
  const res = await handleSendInvitations(
    request({ member_ids: [id(10)] }, { auth: false }),
    deps,
  );
  assertEquals(res.status, 401);
});

Deno.test("member_ids must be a non-empty list of uuids, at most one batch", async () => {
  const { deps, calls } = fakeDeps();
  for (const body of [{}, { member_ids: [] }, { member_ids: ["x"] }]) {
    const res = await handleSendInvitations(request(body), deps);
    assertEquals(res.status, 400);
    assertEquals((await res.json()).code, "member_ids_invalid");
  }
  const tooMany = Array.from({ length: BATCH_LIMIT + 1 }, (_, n) => id(n + 10));
  const res = await handleSendInvitations(
    request({ member_ids: tooMany }),
    deps,
  );
  assertEquals((await res.json()).code, "too_many_members");
  assertEquals(calls, []);
});

Deno.test("a batch sends in order, stamps each send and collapses duplicates", async () => {
  const { deps, calls } = fakeDeps();
  const res = await handleSendInvitations(
    request({ member_ids: [id(10), id(11), id(10).toUpperCase()] }),
    deps,
  );
  const payload = await res.json();
  assertEquals(res.status, 200);
  assertEquals(calls, [
    "invite:10@osubb.local",
    `stamp:${id(10)}`,
    "invite:11@osubb.local",
    `stamp:${id(11)}`,
  ]);
  assertEquals(payload.summary, {
    sent: 2,
    skipped: 0,
    failed: 0,
    not_attempted: 0,
  });
  assertEquals(payload.stopped, null);
  assertEquals(payload.results[0], {
    member_id: id(10),
    status: "sent",
    invited_at: "2026-10-02T10:00:00+00:00",
  });
});

Deno.test("the batch stops cleanly on over_email_send_rate_limit and says where", async () => {
  const { deps, calls } = fakeDeps({
    sendErrors: {
      2: {
        message: "Email rate limit exceeded",
        status: 429,
        code: "over_email_send_rate_limit",
      },
    },
  });
  const res = await handleSendInvitations(
    request({ member_ids: [id(10), id(11), id(12), id(13)] }),
    deps,
  );
  const payload = await res.json();
  assertEquals(res.status, 200);
  // Two sends attempted, the first stamped; nothing after the limit.
  assertEquals(calls, [
    "invite:10@osubb.local",
    `stamp:${id(10)}`,
    "invite:11@osubb.local",
  ]);
  assertEquals(payload.stopped, { reason: "rate_limited", member_id: id(11) });
  assertEquals(
    payload.results.map((r: { status: string }) => r.status),
    ["sent", "rate_limited", "not_attempted", "not_attempted"],
  );
  assertEquals(payload.summary, {
    sent: 1,
    skipped: 0,
    failed: 0,
    not_attempted: 3,
  });
});

Deno.test("a bare 429 from Auth stops the batch too", async () => {
  const { deps } = fakeDeps({
    sendErrors: { 1: { message: "Too many requests", status: 429 } },
  });
  const payload = await (await handleSendInvitations(
    request({ member_ids: [id(10), id(11)] }),
    deps,
  )).json();
  assertEquals(payload.stopped, { reason: "rate_limited", member_id: id(10) });
});

Deno.test("nothing is sent to a Member who signed in, is confirmed, inactive or gone; a failed send does not stop the batch", async () => {
  const { deps, calls } = fakeDeps({
    accounts: {
      [id(10)]: { lastSignInAt: "2026-10-01T00:00:00Z" },
      [id(11)]: { emailConfirmed: true },
      [id(13)]: null,
    },
    profiles: { [id(12)]: { status: "inactiv" } },
    sendErrors: { 1: { message: "smtp down", status: 500 } },
  });
  const payload = await (await handleSendInvitations(
    request({ member_ids: [id(10), id(11), id(12), id(13), id(14), id(15)] }),
    deps,
  )).json();
  assertEquals(
    payload.results.map((r: { code?: string; status: string }) =>
      r.code ?? r.status
    ),
    [
      "already_active",
      "already_confirmed",
      "member_inactive",
      "member_not_found",
      "invite_failed",
      "sent",
    ],
  );
  assertEquals(calls.filter((c) => c.startsWith("invite:")), [
    "invite:14@osubb.local",
    "invite:15@osubb.local",
  ]);
  assertEquals(payload.summary, {
    sent: 1,
    skipped: 4,
    failed: 1,
    not_attempted: 0,
  });
});

Deno.test("a batch stops before the function's time limit", async () => {
  const { deps } = fakeDeps({ sendCost: TIME_BUDGET_MS / 2 + 1 });
  const payload = await (await handleSendInvitations(
    request({ member_ids: [id(10), id(11), id(12)] }),
    deps,
  )).json();
  assertEquals(payload.stopped, { reason: "time_budget", member_id: id(12) });
  assertEquals(
    payload.results.map((r: { status: string }) => r.status),
    ["sent", "sent", "not_attempted"],
  );
});

Deno.test("a failed stamp still reports the invitation as sent", async () => {
  const { deps } = fakeDeps({ stampError: new Error("db down") });
  const payload = await (await handleSendInvitations(
    request({ member_ids: [id(10)] }),
    deps,
  )).json();
  assertEquals(payload.results[0], {
    member_id: id(10),
    status: "sent",
    invited_at: null,
  });
});

// ==================== the corrected address (#997) ====================

Deno.test("a profile address corrected in the grid moves Auth first, and the invitation goes there", async () => {
  const { deps, calls } = fakeDeps({
    profiles: { [id(10)]: { email: " 10@Corectat.local " } },
  });
  const payload = await (await handleSendInvitations(
    request({ member_ids: [id(10), id(11)] }),
    deps,
  )).json();
  assertEquals(calls, [
    "taken?:10@corectat.local",
    `setAuthEmail:${id(10)}:10@corectat.local`,
    "invite:10@corectat.local",
    `stamp:${id(10)}`,
    // A Member whose two addresses agree is sent as before: Auth untouched.
    "invite:11@osubb.local",
    `stamp:${id(11)}`,
  ]);
  assertEquals(payload.summary.sent, 2);
});

Deno.test("an address differing from Auth only in case is not a correction", async () => {
  const { deps, calls } = fakeDeps({
    profiles: { [id(10)]: { email: "10@OSUBB.local" } },
  });
  await handleSendInvitations(request({ member_ids: [id(10)] }), deps);
  assertEquals(calls, ["invite:10@osubb.local", `stamp:${id(10)}`]);
});

Deno.test("a corrected address another profile holds is refused before Auth is touched; the batch goes on", async () => {
  const { deps, calls } = fakeDeps({
    profiles: { [id(10)]: { email: "10@altcineva.local" } },
    takenEmails: ["10@altcineva.local"],
  });
  const payload = await (await handleSendInvitations(
    request({ member_ids: [id(10), id(11)] }),
    deps,
  )).json();
  assertEquals(payload.results[0], {
    member_id: id(10),
    status: "failed",
    code: "email_taken",
    message: "10@altcineva.local este folosită deja de alt cont.",
  });
  assertEquals(calls, [
    "taken?:10@altcineva.local",
    "invite:11@osubb.local",
    `stamp:${id(11)}`,
  ]);
});

Deno.test("a corrected address another Auth user holds is email_taken, and nothing is sent", async () => {
  const { deps, calls } = fakeDeps({
    profiles: { [id(10)]: { email: "10@altcineva.local" } },
    setAuthError: {
      message: "A user with this email address has already been registered",
      status: 422,
      code: "email_exists",
    },
  });
  const payload = await (await handleSendInvitations(
    request({ member_ids: [id(10)] }),
    deps,
  )).json();
  assertEquals(payload.results[0].code, "email_taken");
  assertEquals(payload.summary.failed, 1);
  assertEquals(calls.some((c) => c.startsWith("invite:")), false);
});

Deno.test("Auth refusing the corrected address for another reason sends nothing", async () => {
  const { deps, calls } = fakeDeps({
    profiles: { [id(10)]: { email: "10@corectat.local" } },
    setAuthError: { message: "boom", status: 500 },
  });
  const payload = await (await handleSendInvitations(
    request({ member_ids: [id(10)] }),
    deps,
  )).json();
  assertEquals(payload.results[0].code, "email_sync_failed");
  assertEquals(calls.some((c) => c.startsWith("invite:")), false);
});

Deno.test("an already-invited Member whose addresses differ is refused: no Auth move, no send", async () => {
  const { deps, calls } = fakeDeps({
    profiles: {
      [id(10)]: {
        email: "10@corectat.local",
        invitedAt: "2026-10-01T10:00:00+00:00",
      },
    },
  });
  const payload = await (await handleSendInvitations(
    request({ member_ids: [id(10)] }),
    deps,
  )).json();
  assertEquals(payload.results[0].code, "email_mismatch");
  assertEquals(calls, []);
});

Deno.test("a signed-in Member's differing address is never moved", async () => {
  const { deps, calls } = fakeDeps({
    accounts: { [id(10)]: { lastSignInAt: "2026-10-01T00:00:00Z" } },
    profiles: { [id(10)]: { email: "10@corectat.local" } },
  });
  const payload = await (await handleSendInvitations(
    request({ member_ids: [id(10)] }),
    deps,
  )).json();
  assertEquals(payload.results[0].code, "already_active");
  assertEquals(calls, []);
});
