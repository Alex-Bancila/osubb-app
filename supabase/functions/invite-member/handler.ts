// invite-member — Epic 2.3b.
// The only way an OSUBB account comes into existence (ADR-0003): BC sends a
// magic-link invite, and the member is provisioned in the same request.
// Spec §5.1. The CSV import (#72) reuses this path, one row at a time.
//
// POST { email, full_name, role?, dept_ids?, team_ids? }
//   201 { user_id }        invited and provisioned
//   400                    bad input
//   401 / 403              not signed in / not BC (level < 6)
//   409                    that email already has an account
//
// The ORDER of the steps below is the security-relevant part, and each step
// is there because of a bug this function actually shipped with — see the
// comments, and handler.test.ts, which fails if any of them is undone.

import { corsHeaders, isAllowedOrigin, json } from "../_shared/cors.ts";
import type { InviteDeps } from "./deps.ts";

const INVITE_LEVEL = 6; // BC and above — capability manageRoles (spec §4.1)

interface InviteRequest {
  email?: string;
  full_name?: string;
  role?: string;
  dept_ids?: string[];
  team_ids?: string[];
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
  if (req.method !== "POST") return json({ error: "Use POST." }, 405, origin);

  if (!(req.headers.get("Authorization") ?? "").startsWith("Bearer ")) {
    return json(
      { error: "Autentifică-te pentru a invita membri." },
      401,
      origin,
    );
  }

  const callerId = await deps.callerId();
  if (!callerId) {
    return json({ error: "Sesiune invalidă sau expirată." }, 401, origin);
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
    return json({ error: "Nu am putut verifica permisiunile." }, 500, origin);
  }
  if (callerLevel < INVITE_LEVEL) {
    return json({ error: "Doar BC poate invita membri." }, 403, origin);
  }

  let body: InviteRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Corp de cerere invalid (JSON)." }, 400, origin);
  }

  const email = body.email?.trim().toLowerCase();
  const fullName = body.full_name?.trim();
  if (!email || !email.includes("@")) {
    return json({ error: "Email invalid." }, 400, origin);
  }
  if (!fullName) {
    return json({ error: "Numele este obligatoriu." }, 400, origin);
  }

  const deptIds = body.dept_ids ?? [];
  const teamIds = body.team_ids ?? [];

  try {
    // 1 · departments and teams exist?
    // provision_profile enforces this atomically anyway — but only AFTER the
    // invitation email has gone out. Checking first means a typo never mails
    // a real person an account we then delete. Matters most for the CSV
    // import, where one bad cell shouldn't email anybody.
    for (
      const [table, ids, label] of [
        ["departments", deptIds, "Departament inexistent"],
        ["teams", teamIds, "Echipă inexistentă"],
      ] as const
    ) {
      const missing = await deps.missingIds(table, ids);
      if (missing.length > 0) {
        return json({ error: `${label}: ${missing.join(", ")}.` }, 400, origin);
      }
    }

    // 2 · does this person already exist?
    // Load-bearing, not a nicety. inviteUserByEmail does NOT fail for a known
    // address — it returns the existing user — so without this check the
    // provisioning below fails on the primary key and the compensation in
    // step 4 deletes a real member's auth row, taking their profile and
    // points ledger with it. Re-inviting a colleague must never be
    // destructive.
    if (await deps.profileExists(email)) {
      return json(
        { error: `${email} are deja cont.`, code: "already_exists" },
        409,
        origin,
      );
    }

    // 3 · the magic-link invite creates the auth user and emails them.
    const invited = await deps.inviteByEmail(email);
    if (invited.error || !invited.userId) {
      const known = invited.error?.status === 422 ||
        /already been registered|already exists/i.test(
          invited.error?.message ?? "",
        );
      if (known) {
        return json(
          { error: `${email} are deja cont.`, code: "already_exists" },
          409,
          origin,
        );
      }
      console.error("invite failed", invited.error);
      return json({ error: "Trimiterea invitației a eșuat." }, 502, origin);
    }

    // 4 · provisioning — one atomic call (profile + departments + teams).
    const { error: provisionError } = await deps.provision({
      userId: invited.userId,
      fullName,
      email,
      role: body.role ?? "recrut",
      deptIds,
      teamIds,
    });

    if (provisionError) {
      // A unique violation means someone provisioned this address between
      // step 2 and now. Their profile is the real one — leave the auth user
      // alone. Deleting here is what destroyed a member once.
      if (provisionError.code === "23505") {
        return json(
          { error: `${email} are deja cont.`, code: "already_exists" },
          409,
          origin,
        );
      }

      // Otherwise the data was bad and the user we just created has no
      // profile. The two steps cannot share a transaction — one is the Auth
      // API, the other the database — so undo the half that succeeded, or the
      // address is burned: re-inviting would find a user with nothing to log
      // into.
      await deps.deleteUser(invited.userId);
      console.error("provisioning failed, invite rolled back", provisionError);
      return json(
        {
          error:
            "Datele membrului nu sunt valide (departament sau echipă inexistentă).",
          details: provisionError.message,
        },
        400,
        origin,
      );
    }

    return json({ user_id: invited.userId, email }, 201, origin);
  } catch (error) {
    console.error("invite-member failed", error);
    return json({ error: "Ceva n-a mers. Încearcă din nou." }, 500, origin);
  }
}
