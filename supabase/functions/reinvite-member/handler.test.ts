// Tests for reinvite-member (#773). Run with `deno test supabase/functions/`.
//
// Named for the damage, as invite-member's are: an edit that re-orders the
// steps fails with a message that says what it broke.

import { assertEquals } from "@std/assert";
import { handleReinvite } from "./handler.ts";
import type {
  AuthAccount,
  AuthError,
  CallerNotice,
  DbError,
  MemberProfile,
  ReinviteDeps,
} from "./deps.ts";

const MEMBER = "11111111-2222-4333-8444-555555555555";

interface FakeOptions {
  callerId?: string | null;
  level?: number;
  account?: Partial<AuthAccount> | null;
  profile?: Partial<MemberProfile> | null;
  emailTaken?: boolean;
  authEmailError?: AuthError;
  rollbackError?: AuthError;
  profileEmailError?: DbError;
  inviteError?: AuthError;
  invitedUserId?: string;
  notifyError?: Error;
}

/** A fake port that records every call, so tests can assert order and absence. */
function fakeDeps(options: FakeOptions = {}) {
  const calls: string[] = [];
  const notices: CallerNotice[] = [];
  let authWrites = 0;

  const deps: ReinviteDeps = {
    callerId: () => {
      calls.push("callerId");
      return Promise.resolve(
        options.callerId === undefined ? "caller-1" : options.callerId,
      );
    },
    memberLevel: () => {
      calls.push("memberLevel");
      return Promise.resolve(options.level ?? 6);
    },
    authAccount: () => {
      calls.push("authAccount");
      return Promise.resolve(
        options.account === null ? null : {
          email: "gresit@osubb.local",
          lastSignInAt: null,
          emailConfirmed: false,
          ...options.account,
        },
      );
    },
    profile: () => {
      calls.push("profile");
      return Promise.resolve(
        options.profile === null ? null : {
          email: "gresit@osubb.local",
          fullName: "Ioana Popescu",
          status: "activ",
          ...options.profile,
        },
      );
    },
    emailTaken: () => {
      calls.push("emailTaken");
      return Promise.resolve(options.emailTaken ?? false);
    },
    setAuthEmail: (_id, email) => {
      calls.push(`setAuthEmail:${email}`);
      authWrites += 1;
      const error = authWrites === 1
        ? options.authEmailError
        : options.rollbackError;
      return Promise.resolve(error ? { error } : {});
    },
    setProfileEmail: (_id, email) => {
      calls.push(`setProfileEmail:${email}`);
      return Promise.resolve(
        options.profileEmailError ? { error: options.profileEmailError } : {},
      );
    },
    inviteByEmail: (email) => {
      calls.push(`inviteByEmail:${email}`);
      return Promise.resolve(
        options.inviteError
          ? { error: options.inviteError }
          : { userId: options.invitedUserId ?? MEMBER },
      );
    },
    notifyCaller: (callerId, notice) => {
      calls.push(`notifyCaller:${callerId}`);
      notices.push(notice);
      return options.notifyError
        ? Promise.reject(options.notifyError)
        : Promise.resolve();
    },
  };

  return { deps, calls, notices };
}

function request(body: unknown, { auth = true } = {}): Request {
  return new Request("http://localhost/reinvite-member", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: "Bearer token" } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const mutations = (calls: string[]) =>
  calls.filter((call) =>
    /^(setAuthEmail|setProfileEmail|inviteByEmail|notifyCaller)/.test(call)
  );

// ==================== the acceptance criteria ====================

Deno.test("a Member who has signed in is refused before anything changes", async () => {
  const { deps, calls } = fakeDeps({
    account: { lastSignInAt: "2026-09-20T10:00:00Z" },
  });

  const res = await handleReinvite(
    request({ member_id: MEMBER, email: "corect@osubb.local" }),
    deps,
  );
  const payload = await res.json();

  assertEquals(res.status, 409);
  assertEquals(payload.code, "already_active");
  // Their address is theirs now: no correction, no stray sign-in link.
  assertEquals(mutations(calls), []);
});

Deno.test("a corrected address is written to Auth, then the profile, then invited", async () => {
  const { deps, calls, notices } = fakeDeps();

  const res = await handleReinvite(
    request({ member_id: MEMBER, email: "  Corect@OSUBB.local " }),
    deps,
  );
  const payload = await res.json();

  assertEquals(res.status, 200);
  assertEquals(payload, {
    member_id: MEMBER,
    email: "corect@osubb.local",
    email_changed: true,
  });
  // The invitation goes to the address both sides already hold — never
  // before the correction, never to the old one.
  assertEquals(mutations(calls), [
    "setAuthEmail:corect@osubb.local",
    "setProfileEmail:corect@osubb.local",
    "inviteByEmail:corect@osubb.local",
    "notifyCaller:caller-1",
  ]);
  assertEquals(notices, [{
    title: "Invitație retrimisă",
    body:
      "Invitația pentru Ioana Popescu a fost retrimisă la corect@osubb.local. Adresa anterioară: gresit@osubb.local.",
    link: `/administrare/membri/${MEMBER}`,
  }]);
});

Deno.test("re-sending to the same address changes nothing and only invites", async () => {
  const { deps, calls } = fakeDeps();

  const res = await handleReinvite(request({ member_id: MEMBER }), deps);
  const payload = await res.json();

  assertEquals(res.status, 200);
  assertEquals(payload.email_changed, false);
  assertEquals(mutations(calls), [
    "inviteByEmail:gresit@osubb.local",
    "notifyCaller:caller-1",
  ]);
});

Deno.test("a profile that refuses the new address puts Auth back and sends nothing", async () => {
  const { deps, calls } = fakeDeps({
    profileEmailError: { code: "XX000", message: "boom" },
  });

  const res = await handleReinvite(
    request({ member_id: MEMBER, email: "corect@osubb.local" }),
    deps,
  );
  const payload = await res.json();

  assertEquals(res.status, 500);
  assertEquals(payload.code, "email_sync_failed");
  assertEquals(mutations(calls), [
    "setAuthEmail:corect@osubb.local",
    "setProfileEmail:corect@osubb.local",
    "setAuthEmail:gresit@osubb.local",
  ]);
});

Deno.test("a failed rollback is reported as a divergence, never as nothing changed", async () => {
  const { deps, calls } = fakeDeps({
    profileEmailError: { code: "XX000", message: "boom" },
    rollbackError: { message: "auth down", status: 500 },
  });

  const res = await handleReinvite(
    request({ member_id: MEMBER, email: "corect@osubb.local" }),
    deps,
  );
  const payload = await res.json();

  assertEquals(res.status, 500);
  assertEquals(payload.code, "email_out_of_sync");
  assertEquals(calls.some((call) => call.startsWith("inviteByEmail")), false);
});

Deno.test("an address another profile holds is refused before Auth is touched", async () => {
  const { deps, calls } = fakeDeps({ emailTaken: true });

  const res = await handleReinvite(
    request({ member_id: MEMBER, email: "altcineva@osubb.local" }),
    deps,
  );
  const payload = await res.json();

  assertEquals(res.status, 409);
  assertEquals(payload.code, "email_taken");
  assertEquals(mutations(calls), []);
});

Deno.test("an address another Auth user holds is refused and nothing else runs", async () => {
  const { deps, calls } = fakeDeps({
    authEmailError: {
      message: "A user with this email address has already been registered",
      status: 422,
    },
  });

  const res = await handleReinvite(
    request({ member_id: MEMBER, email: "altcineva@osubb.local" }),
    deps,
  );
  const payload = await res.json();

  assertEquals(res.status, 409);
  assertEquals(payload.code, "email_taken");
  assertEquals(mutations(calls), ["setAuthEmail:altcineva@osubb.local"]);
});

Deno.test("a confirmed address is refused before it is touched", async () => {
  const { deps, calls } = fakeDeps({ account: { emailConfirmed: true } });

  const res = await handleReinvite(
    request({ member_id: MEMBER, email: "corect@osubb.local" }),
    deps,
  );
  const payload = await res.json();

  assertEquals(res.status, 409);
  assertEquals(payload.code, "already_confirmed");
  assertEquals(mutations(calls), []);
});

Deno.test("an inactive Member is refused", async () => {
  const { deps, calls } = fakeDeps({ profile: { status: "inactiv" } });

  const res = await handleReinvite(request({ member_id: MEMBER }), deps);
  const payload = await res.json();

  assertEquals(res.status, 409);
  assertEquals(payload.code, "member_inactive");
  assertEquals(mutations(calls), []);
});

Deno.test("an unknown Member is 404", async () => {
  const { deps, calls } = fakeDeps({ profile: null });

  const res = await handleReinvite(request({ member_id: MEMBER }), deps);
  const payload = await res.json();

  assertEquals(res.status, 404);
  assertEquals(payload.code, "member_not_found");
  assertEquals(mutations(calls), []);
});

Deno.test("a failed send keeps the correction and says so", async () => {
  const { deps, calls } = fakeDeps({
    inviteError: { message: "smtp down", status: 500 },
  });

  const res = await handleReinvite(
    request({ member_id: MEMBER, email: "corect@osubb.local" }),
    deps,
  );
  const payload = await res.json();

  assertEquals(res.status, 502);
  assertEquals(payload.code, "invite_failed");
  assertEquals(
    payload.error,
    "Adresa a fost corectată, dar trimiterea invitației a eșuat. Reîncearcă.",
  );
  assertEquals(calls.includes("notifyCaller:caller-1"), false);
});

Deno.test("an invitation that reaches another account is a failed send, not a success", async () => {
  const { deps, calls } = fakeDeps({ invitedUserId: "someone-else" });

  const res = await handleReinvite(request({ member_id: MEMBER }), deps);
  const payload = await res.json();

  assertEquals(res.status, 502);
  assertEquals(payload.code, "invite_failed");
  assertEquals(calls.includes("notifyCaller:caller-1"), false);
});

Deno.test("a profile address differing only in case is not a correction", async () => {
  const { deps, calls } = fakeDeps({
    profile: { email: "Gresit@OSUBB.local" },
  });

  const res = await handleReinvite(request({ member_id: MEMBER }), deps);
  const payload = await res.json();

  assertEquals(res.status, 200);
  assertEquals(payload.email_changed, false);
  assertEquals(mutations(calls), [
    "inviteByEmail:gresit@osubb.local",
    "notifyCaller:caller-1",
  ]);
});

Deno.test("a failed audit Notification does not fail a sent invitation", async () => {
  const { deps } = fakeDeps({ notifyError: new Error("insert failed") });

  const res = await handleReinvite(request({ member_id: MEMBER }), deps);

  assertEquals(res.status, 200);
});

// ==================== the status read ====================

Deno.test("status answers the sign-in state and changes nothing", async () => {
  const { deps, calls } = fakeDeps({
    account: { lastSignInAt: "2026-09-20T10:00:00Z" },
  });

  const res = await handleReinvite(
    request({ member_id: MEMBER, action: "status" }),
    deps,
  );

  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    member_id: MEMBER,
    email: "gresit@osubb.local",
    last_sign_in_at: "2026-09-20T10:00:00Z",
    email_confirmed: false,
  });
  assertEquals(mutations(calls), []);
});

// ==================== who may call ====================

Deno.test("no Authorization header is refused", async () => {
  const { deps, calls } = fakeDeps();
  const res = await handleReinvite(
    request({ member_id: MEMBER }, { auth: false }),
    deps,
  );
  assertEquals(res.status, 401);
  assertEquals(calls, []);
});

Deno.test("an invalid session is refused", async () => {
  const { deps, calls } = fakeDeps({ callerId: null });
  const res = await handleReinvite(request({ member_id: MEMBER }), deps);
  assertEquals(res.status, 401);
  assertEquals(calls, ["callerId"]);
});

Deno.test("a caller below level 6 is refused, for the status read too", async () => {
  for (const action of ["status", "reinvite"]) {
    const { deps, calls } = fakeDeps({ level: 5 });
    const res = await handleReinvite(
      request({ member_id: MEMBER, action }),
      deps,
    );
    const payload = await res.json();
    assertEquals(res.status, 403);
    assertEquals(payload.code, "member_manage_forbidden");
    // The level is read from the database, and nothing about the Member is.
    assertEquals(calls, ["callerId", "memberLevel"]);
  }
});

// ==================== input ====================

Deno.test("bad input is refused before the Member is read", async () => {
  const bodies: unknown[] = [
    "{not json",
    [],
    { member_id: "not-a-uuid" },
    { member_id: MEMBER, email: 42 },
    { member_id: MEMBER, action: "delete" },
  ];
  for (const body of bodies) {
    const { deps, calls } = fakeDeps();
    const res = await handleReinvite(request(body), deps);
    assertEquals(res.status, 400);
    assertEquals(calls, ["callerId", "memberLevel"]);
  }
});

Deno.test("a malformed new address is refused before anything changes", async () => {
  const { deps, calls } = fakeDeps();
  const res = await handleReinvite(
    request({ member_id: MEMBER, email: "fara-arond" }),
    deps,
  );
  const payload = await res.json();
  assertEquals(res.status, 400);
  assertEquals(payload.code, "email_invalid");
  assertEquals(mutations(calls), []);
});
