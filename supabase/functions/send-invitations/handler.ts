// send-invitations — #991. Sends the invitations of the volunteer import (or
// any never-signed-in Member) in one batch: BC picks the Members in the
// "De invitat" grid and the app calls this once per batch, showing progress.
//
// POST { member_ids: string[] }       1..50 uuids, duplicates collapsed
//   200 {
//     summary: { sent, skipped, failed, not_attempted },
//     stopped: null | { reason: "rate_limited" | "time_budget", member_id },
//     results: [{ member_id, status, invited_at?, code?, message? }]
//   }
//   status per Member:
//     sent           Auth accepted the invitation; invited_at stamped
//     skipped        nothing to send: already_active (signed in),
//                    already_confirmed, member_inactive, member_not_found
//     failed         the batch goes on: invite_failed (Auth refused the send),
//                    email_taken (the Profile's corrected address belongs to
//                    another account), email_sync_failed (Auth refused to
//                    move to it; nothing was sent)
//     rate_limited   Auth answered over_email_send_rate_limit: the batch
//                    STOPS here, this Member got nothing
//     not_attempted  after a stop; send them in a later batch
//   400 invalid_json / invalid_body / member_ids_invalid / too_many_members
//   401 / 403   not signed in / not BC or the Moderator (level < 6)
//
// The batch stops cleanly at the first rate-limit answer, and also before
// the function's own time limit (stopped.reason "time_budget"), so a batch
// never dies half-way without saying where it stopped. Members are sent in
// the order given. Like reinvite-member it never creates or deletes an
// account: Auth re-sends an invitation to an existing unconfirmed user,
// keeping its id.
//
// The invitation goes to the PROFILE's address. The De invitat grid writes
// profiles.email when BC corrects an address (#992), and Auth's copy would
// otherwise still hold the imported one; so a Member whose two addresses
// differ has Auth moved to the Profile's first, as reinvite-member does
// (address lookup, then auth.admin.updateUserById). No profile write and no
// rollback: the Profile already holds the new address, so the row either
// stays as it was or both sides hold the new one before the mail leaves.

import {
  corsHeaders,
  isAllowedOrigin,
  json,
  refusal,
} from "../_shared/cors.ts";
import type { SendInvitationsDeps } from "./deps.ts";

export const SEND_LEVEL = 6;
export const BATCH_LIMIT = 50;
/** Stop starting new sends after this long; hosted functions get 150 s. */
export const TIME_BUDGET_MS = 100_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Status =
  | "sent"
  | "skipped"
  | "failed"
  | "rate_limited"
  | "not_attempted";

interface Result {
  member_id: string;
  status: Status;
  invited_at?: string | null;
  code?: string;
  message?: string;
}

function isRateLimit(error: { code?: string; status?: number }): boolean {
  return error.code === "over_email_send_rate_limit" || error.status === 429;
}

function isDuplicate(error: { message: string; status?: number }): boolean {
  return error.status === 422 ||
    /already been registered|already exists/i.test(error.message);
}

export async function handleSendInvitations(
  req: Request,
  deps: SendInvitationsDeps,
): Promise<Response> {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    if (!isAllowedOrigin(origin)) {
      return new Response(null, { status: 403, headers: corsHeaders(origin) });
    }
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return refusal("method_not_allowed", "Use POST.", 405, origin);
  }
  if (!(req.headers.get("Authorization") ?? "").startsWith("Bearer ")) {
    return refusal(
      "not_signed_in",
      "Autentifică-te pentru a trimite invitații.",
      401,
      origin,
    );
  }

  let callerId: string | null;
  try {
    callerId = await deps.callerId();
  } catch {
    callerId = null;
  }
  if (!callerId) {
    return refusal(
      "session_invalid",
      "Sesiune invalidă sau expirată.",
      401,
      origin,
    );
  }
  let level: number;
  try {
    level = await deps.memberLevel(callerId);
  } catch (error) {
    console.error("send-invitations caller lookup failed", {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return refusal(
      "permission_check_failed",
      "Nu am putut verifica permisiunile.",
      500,
      origin,
    );
  }
  if (level < SEND_LEVEL) {
    return refusal(
      "member_manage_forbidden",
      "Doar BC sau Moderatorul poate trimite invitații.",
      403,
      origin,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return refusal(
      "invalid_json",
      "Corp de cerere invalid (JSON).",
      400,
      origin,
    );
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return refusal(
      "invalid_body",
      "Corpul cererii trebuie să fie un obiect.",
      400,
      origin,
    );
  }
  const ids = (body as { member_ids?: unknown }).member_ids;
  if (
    !Array.isArray(ids) || ids.length === 0 ||
    !ids.every((id) => typeof id === "string" && UUID.test(id))
  ) {
    return refusal(
      "member_ids_invalid",
      "member_ids trebuie să fie o listă de id-uri de membri.",
      400,
      origin,
    );
  }
  const memberIds = [...new Set(ids.map((id) => (id as string).toLowerCase()))];
  if (memberIds.length > BATCH_LIMIT) {
    return refusal(
      "too_many_members",
      `Un lot poate avea cel mult ${BATCH_LIMIT} de membri.`,
      400,
      origin,
    );
  }

  const started = deps.now();
  const results: Result[] = [];
  let stopped:
    | { reason: "rate_limited" | "time_budget"; member_id: string }
    | null = null;

  for (const memberId of memberIds) {
    if (stopped) {
      results.push({ member_id: memberId, status: "not_attempted" });
      continue;
    }
    if (deps.now() - started > TIME_BUDGET_MS) {
      stopped = { reason: "time_budget", member_id: memberId };
      results.push({ member_id: memberId, status: "not_attempted" });
      continue;
    }
    const result = await sendOne(memberId, deps);
    if (result.status === "rate_limited") {
      stopped = { reason: "rate_limited", member_id: memberId };
    }
    results.push(result);
  }

  const count = (status: Status) =>
    results.filter((result) => result.status === status).length;
  return json(
    {
      summary: {
        sent: count("sent"),
        skipped: count("skipped"),
        failed: count("failed"),
        not_attempted: count("not_attempted") + count("rate_limited"),
      },
      stopped,
      results,
    },
    200,
    origin,
  );
}

async function sendOne(
  memberId: string,
  deps: SendInvitationsDeps,
): Promise<Result> {
  const skipped = (code: string, message: string): Result => ({
    member_id: memberId,
    status: "skipped",
    code,
    message,
  });
  const failed: Result = {
    member_id: memberId,
    status: "failed",
    code: "invite_failed",
    message: "Trimiterea invitației a eșuat.",
  };
  try {
    const [account, profile] = await Promise.all([
      deps.authAccount(memberId),
      deps.profile(memberId),
    ]);
    if (!account || !profile) {
      return skipped("member_not_found", "Membrul nu mai este disponibil.");
    }
    if (account.lastSignInAt !== null) {
      return skipped("already_active", "Membrul s-a autentificat deja.");
    }
    if (account.emailConfirmed) {
      return skipped(
        "already_confirmed",
        "Adresa este deja confirmată: se autentifică din ecranul de login.",
      );
    }
    if (profile.status !== "activ") {
      return skipped("member_inactive", "Membrul nu este activ.");
    }

    // The Profile's address is the one BC corrected in the grid; Auth
    // follows it before the mail leaves, or this row fails and nothing is
    // sent. A case-only difference names the same mailbox: nothing moves.
    let email = account.email;
    const corrected = profile.email.trim().toLowerCase();
    if (corrected !== account.email.toLowerCase()) {
      const taken: Result = {
        member_id: memberId,
        status: "failed",
        code: "email_taken",
        message: `${corrected} este folosită deja de alt cont.`,
      };
      if (await deps.emailTaken(corrected, memberId)) return taken;
      const moved = await deps.setAuthEmail(memberId, corrected);
      if (moved.error) {
        if (isDuplicate(moved.error)) return taken;
        console.error("send-invitations auth email move failed", {
          status: moved.error.status,
          code: moved.error.code,
        });
        return {
          member_id: memberId,
          status: "failed",
          code: "email_sync_failed",
          message:
            "Nu am putut muta adresa de autentificare. Nimic nu a fost trimis.",
        };
      }
      email = corrected;
    }

    const invited = await deps.inviteByEmail(email);
    if (invited.error || !invited.userId) {
      if (invited.error && isRateLimit(invited.error)) {
        return {
          member_id: memberId,
          status: "rate_limited",
          code: "over_email_send_rate_limit",
          message:
            "Limita de emailuri a fost atinsă. Reia trimiterea mai târziu.",
        };
      }
      if (invited.error && isDuplicate(invited.error)) {
        return skipped(
          "already_confirmed",
          "Adresa este deja confirmată: se autentifică din ecranul de login.",
        );
      }
      console.error("send-invitations send failed", {
        status: invited.error?.status,
        code: invited.error?.code,
      });
      return failed;
    }
    if (invited.userId !== memberId) {
      console.error("send-invitations answered a different user");
      return failed;
    }

    let invitedAt: string | null = null;
    try {
      invitedAt = await deps.recordInvitationSent(memberId);
    } catch (error) {
      // The mail has left: still "sent". The grid keeps showing the Member
      // until the stamp is written, which a re-send would do.
      console.error("send-invitations stamp failed", {
        errorType: error instanceof Error ? error.name : typeof error,
      });
    }
    return { member_id: memberId, status: "sent", invited_at: invitedAt };
  } catch (error) {
    console.error("send-invitations member failed", {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return failed;
  }
}
