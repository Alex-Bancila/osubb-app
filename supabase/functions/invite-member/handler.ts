// invite-member — Epic 2.3b.
// The only way an OSUBB account comes into existence (ADR-0003): BC sends a
// magic-link invite, and the member is provisioned in the same request.
// Spec §5.1. The CSV import (#72) reuses this path, one row at a time.
//
// POST { email, full_name, role?, group_ids? }
//   201 { user_id }        invited and provisioned
//   400                    bad input
//   401 / 403              not signed in / not BC (level < 6)
//   403 member_manage_forbidden
//                          role bc or moderator from anyone but the Moderator
//   409 already_exists     that email already has an account
//
// Every error body is { code, error } (_shared/errors.ts): a stable reason
// and a fixed message. Database and Auth details go to the function log only.
//
// Since #602 the initial placement is a list of GROUP ids, appointed through
// the roster path with the caller as the Appointment's actor. `dept_ids` and
// `team_ids` are gone and are refused loudly rather than ignored: a silently
// dropped field would create a member placed nowhere, which is worse than an
// error a BC can read.
//
// The ORDER of the steps below is the security-relevant part, and each step
// is there because of a bug this function actually shipped with — see the
// comments, and handler.test.ts, which fails if any of them is undone.

import {
  corsHeaders,
  isAllowedOrigin,
  json,
  refusal,
} from "../_shared/cors.ts";
import { inviteMember, mayHandleRole } from "../_shared/member-invite.ts";
import type { InviteDeps } from "./deps.ts";

const INVITE_LEVEL = 6; // BC and above — capability manageRoles (spec §4.1)

interface InviteRequest {
  email?: string;
  full_name?: string;
  role?: string;
  group_ids?: unknown;
}

export async function handleInvite(
  req: Request,
  deps: InviteDeps,
): Promise<Response> {
  // Server-to-server calls (curl, another function, CI) send no Origin header
  // at all — only browsers do. isAllowedOrigin(null) is false, so those calls
  // never get an Access-Control-Allow-Origin echoed back, but they also never
  // need one: CORS only gates browser fetches. A null origin is therefore
  // refused on preflight (a real browser preflight always carries Origin) but
  // POSTs without one still reach the normal auth checks below.
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
      "Autentifică-te pentru a invita membri.",
      401,
      origin,
    );
  }

  const callerId = await deps.callerId();
  if (!callerId) {
    return refusal(
      "session_invalid",
      "Sesiune invalidă sau expirată.",
      401,
      origin,
    );
  }

  // Authorization reads the level from the DATABASE, not from the caller's
  // claims: a token issued before a demotion still carries the old level for
  // up to an hour, and this endpoint creates accounts. memberLevel() answers
  // 0 for anyone missing or inactive, so one comparison covers every case.
  let callerLevel: number;
  try {
    callerLevel = await deps.memberLevel(callerId);
  } catch (error) {
    console.error("caller lookup failed", error);
    return refusal(
      "permission_check_failed",
      "Nu am putut verifica permisiunile.",
      500,
      origin,
    );
  }
  if (callerLevel < INVITE_LEVEL) {
    return refusal(
      "member_manage_forbidden",
      "Doar BC poate invita membri.",
      403,
      origin,
    );
  }

  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return refusal(
      "invalid_json",
      "Corp de cerere invalid (JSON).",
      400,
      origin,
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return refusal(
      "invalid_body",
      "Corpul cererii trebuie să fie un obiect.",
      400,
      origin,
    );
  }
  if ("dept_ids" in parsed || "team_ids" in parsed) {
    return refusal(
      "legacy_placement_fields",
      "Câmpurile dept_ids și team_ids nu mai există. Trimite group_ids.",
      400,
      origin,
    );
  }

  const body = parsed as InviteRequest;
  if (
    (body.email !== undefined && typeof body.email !== "string") ||
    (body.full_name !== undefined && typeof body.full_name !== "string") ||
    (body.role !== undefined && typeof body.role !== "string")
  ) {
    return refusal(
      "invalid_body",
      "Câmpurile email, full_name și role trebuie să fie text.",
      400,
      origin,
    );
  }

  const email = body.email?.trim().toLowerCase();
  const fullName = body.full_name?.trim();
  if (!email || !email.includes("@")) {
    return refusal("email_invalid", "Email invalid.", 400, origin);
  }
  if (!fullName) {
    return refusal(
      "full_name_required",
      "Numele este obligatoriu.",
      400,
      origin,
    );
  }

  const rawGroupIds = body.group_ids ?? [];
  if (
    !Array.isArray(rawGroupIds) ||
    rawGroupIds.some((id) => !Number.isSafeInteger(id))
  ) {
    return refusal(
      "invalid_group_ids",
      "group_ids trebuie să fie o listă de id-uri de grup.",
      400,
      origin,
    );
  }
  const groupIds = rawGroupIds as number[];

  // Only the Moderator creates a BC or Moderator account (H1) — the rule
  // set_member_role applies. provision_profile refuses it too; answering here
  // means no Auth user is ever created for a refused rank.
  const role = body.role ?? "recrut";
  if (!mayHandleRole(role, callerLevel)) {
    return refusal(
      "member_manage_forbidden",
      "Doar Moderatorul poate crea conturi de BC sau Moderator.",
      403,
      origin,
    );
  }

  try {
    const result = await inviteMember({
      fullName,
      email,
      role,
      groupIds,
      appointedBy: callerId,
    }, deps);

    switch (result.kind) {
      case "created":
        return json(
          { user_id: result.userId, email: result.email },
          201,
          origin,
        );
      case "already_exists":
        return refusal(
          "already_exists",
          `${email} are deja cont.`,
          409,
          origin,
        );
      case "invalid_reference":
        return refusal("invalid_reference", result.message, 400, origin);
      case "invite_failed":
        console.error("invite failed", result.cause);
        return refusal(
          "invite_failed",
          "Trimiterea invitației a eșuat.",
          502,
          origin,
        );
      case "provision_failed":
        // The database's own words stay in the log (security pass L4): they
        // name constraints, functions and columns a caller has no use for.
        console.error(
          "provisioning failed, invite rolled back",
          result.details,
          result.cause,
        );
        return refusal(
          "provision_failed",
          "Datele membrului nu sunt valide (un grup inexistent, arhivat, automat sau peste nivelul membrului).",
          400,
          origin,
        );
    }
  } catch (error) {
    console.error("invite-member failed", error);
    return refusal(
      "unexpected_error",
      "Ceva n-a mers. Încearcă din nou.",
      500,
      origin,
    );
  }
}
