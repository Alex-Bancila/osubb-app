// reinvite-member — #773, ruling L19 of the 2026-09-25 launch grill.
// Corrects the address of a Member who has NEVER signed in and sends their
// invitation again, without deleting or re-provisioning anything: the profile
// id, its Groups and its history stay exactly as they are.
//
// POST { member_id, action: "status" }
//   200 { member_id, email, last_sign_in_at, email_confirmed }
//                          what the Administrare page needs to show the
//                          control: never signed in, address unconfirmed
// POST { member_id, email? }                     (action "reinvite", default)
//   200 { member_id, email, email_changed }      invitation sent again
//   400                    bad input
//   401 / 403              not signed in / not BC or Moderator (level < 6)
//   404 member_not_found   no such Member
//   409 already_active     the Member has signed in: nothing to re-send
//   409 member_inactive    the profile is not activ: an invitation would
//                          open nothing
//   409 email_taken        another account already uses the new address
//   409 already_confirmed  the address is confirmed without a sign-in (seed
//                          data): the Member signs in from the login screen
//   500 email_sync_failed  the new address was refused; nothing changed
//   500 email_out_of_sync  the profile refused AND Auth could not be put
//                          back: the two addresses differ until fixed by hand
//   502 invite_failed      Auth could not send the email
//
// `invite-member` refuses an existing profile on purpose — that is what keeps
// a real Member from being deleted by its compensation step. This function is
// the recovery path that refusal left missing, and it never creates or
// deletes an account (its port has no `deleteUser` at all).

import { corsHeaders, isAllowedOrigin, json } from "../_shared/cors.ts";
import type { ReinviteDeps } from "./deps.ts";

const REINVITE_LEVEL = 6; // BC and the Moderator — capability manageRoles

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ReinviteRequest {
  member_id?: unknown;
  email?: unknown;
  action?: unknown;
}

function refusal(
  code: string,
  error: string,
  status: number,
  origin: string | null,
): Response {
  return json({ error, code }, status, origin);
}

/** Auth's answer when an address already belongs to a confirmed account. */
function isDuplicate(error: { message: string; status?: number }): boolean {
  return error.status === 422 ||
    /already been registered|already exists/i.test(error.message);
}

export async function handleReinvite(
  req: Request,
  deps: ReinviteDeps,
): Promise<Response> {
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
      { error: "Autentifică-te pentru a retrimite invitații." },
      401,
      origin,
    );
  }

  const callerId = await deps.callerId();
  if (!callerId) {
    return json({ error: "Sesiune invalidă sau expirată." }, 401, origin);
  }

  // The level comes from the DATABASE, as in invite-member: a token issued
  // before a demotion still carries the old level for up to an hour.
  let callerLevel: number;
  try {
    callerLevel = await deps.memberLevel(callerId);
  } catch (error) {
    console.error("caller lookup failed", error);
    return json({ error: "Nu am putut verifica permisiunile." }, 500, origin);
  }
  if (callerLevel < REINVITE_LEVEL) {
    return refusal(
      "member_manage_forbidden",
      "Doar BC sau Moderatorul poate retrimite invitații.",
      403,
      origin,
    );
  }

  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return json({ error: "Corp de cerere invalid (JSON)." }, 400, origin);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return json(
      { error: "Corpul cererii trebuie să fie un obiect." },
      400,
      origin,
    );
  }

  const body = parsed as ReinviteRequest;
  const action = body.action ?? "reinvite";
  if (action !== "status" && action !== "reinvite") {
    return json(
      { error: "action trebuie să fie „status” sau „reinvite”." },
      400,
      origin,
    );
  }
  if (typeof body.member_id !== "string" || !UUID.test(body.member_id)) {
    return json({ error: "member_id invalid." }, 400, origin);
  }
  if (body.email !== undefined && typeof body.email !== "string") {
    return json({ error: "Câmpul email trebuie să fie text." }, 400, origin);
  }
  const memberId = body.member_id.toLowerCase();

  try {
    const [account, profile] = await Promise.all([
      deps.authAccount(memberId),
      deps.profile(memberId),
    ]);
    if (!account || !profile) {
      return refusal(
        "member_not_found",
        "Membrul nu mai este disponibil.",
        404,
        origin,
      );
    }

    if (action === "status") {
      return json(
        {
          member_id: memberId,
          email: account.email,
          last_sign_in_at: account.lastSignInAt,
          email_confirmed: account.emailConfirmed,
        },
        200,
        origin,
      );
    }

    // First, before anything changes: a Member who has signed in owns their
    // address, and an invitation would only be a stray sign-in link.
    if (account.lastSignInAt !== null) {
      return refusal(
        "already_active",
        "Membrul s-a autentificat deja. Invitația nu se mai retrimite.",
        409,
        origin,
      );
    }
    // Auth only re-sends an invitation to an unconfirmed address. A confirmed
    // one without a sign-in (seed data, a hand-made account) needs no
    // invitation: the Member asks for a link on the login screen. Refused
    // here, before the address is touched.
    if (account.emailConfirmed) {
      return refusal(
        "already_confirmed",
        "Adresa membrului este deja confirmată. Se poate autentifica direct din ecranul de login.",
        409,
        origin,
      );
    }
    if (profile.status !== "activ") {
      return refusal(
        "member_inactive",
        "Membrul nu este activ. Reactivează-l înainte de a-i retrimite invitația.",
        409,
        origin,
      );
    }

    const email = (body.email ?? account.email).trim().toLowerCase();
    if (!email || !email.includes("@")) {
      return refusal("email_invalid", "Email invalid.", 400, origin);
    }

    const authChanges = email !== account.email.toLowerCase();
    const profileChanges = email !== profile.email.toLowerCase();
    if (
      (authChanges || profileChanges) && await deps.emailTaken(email, memberId)
    ) {
      return refusal(
        "email_taken",
        `${email} este folosită deja de alt cont.`,
        409,
        origin,
      );
    }

    // The two addresses live in two systems, Auth and Postgres, and no
    // transaction spans both. So Auth moves first and is moved back if the
    // profile refuses: the only state either side can be left in is the one
    // it started from, and the invitation is never sent to an address the
    // profile does not also hold.
    if (authChanges) {
      const { error } = await deps.setAuthEmail(memberId, email);
      if (error) {
        if (isDuplicate(error)) {
          return refusal(
            "email_taken",
            `${email} este folosită deja de alt cont.`,
            409,
            origin,
          );
        }
        console.error("auth email update failed", error);
        return refusal(
          "email_sync_failed",
          "Nu am putut schimba adresa. Nimic nu a fost modificat.",
          500,
          origin,
        );
      }
    }
    if (profileChanges) {
      const { error } = await deps.setProfileEmail(memberId, email);
      if (error) {
        console.error("profile email update failed", error);
        if (authChanges) {
          const rollback = await deps.setAuthEmail(memberId, account.email);
          if (rollback.error) {
            // Loud on purpose: the two addresses now differ and a human must
            // put Auth back by hand (docs/backend/inviting.md).
            console.error(
              "ROLLBACK FAILED: auth.users.email and profiles.email differ",
              { memberId, auth: email, profile: profile.email },
              rollback.error,
            );
            // Not "nothing changed": the caller must know the two sides
            // differ, or a retry would start from a state nobody expects.
            return refusal(
              "email_out_of_sync",
              "Adresa s-a schimbat în Auth, dar nu și în profil. Trebuie corectată manual (docs/backend/inviting.md).",
              500,
              origin,
            );
          }
        }
        return error.code === "23505"
          ? refusal(
            "email_taken",
            `${email} este folosită deja de alt cont.`,
            409,
            origin,
          )
          : refusal(
            "email_sync_failed",
            "Nu am putut schimba adresa. Nimic nu a fost modificat.",
            500,
            origin,
          );
      }
    }

    // Auth re-sends the invitation to an existing user whose address is not
    // yet confirmed, keeping the user (and so the profile id) as it is; a
    // confirmed address answers 422 instead of creating anything.
    const invited = await deps.inviteByEmail(email);
    if (invited.error || !invited.userId) {
      if (invited.error && isDuplicate(invited.error)) {
        return refusal(
          "already_confirmed",
          "Adresa membrului este deja confirmată. Se poate autentifica direct din ecranul de login.",
          409,
          origin,
        );
      }
      console.error("re-invite failed", invited.error);
      return refusal(
        "invite_failed",
        authChanges || profileChanges
          ? "Adresa a fost corectată, dar trimiterea invitației a eșuat. Reîncearcă."
          : "Trimiterea invitației a eșuat. Reîncearcă.",
        502,
        origin,
      );
    }
    if (invited.userId !== memberId) {
      // Auth answered another account: this Member got no invitation, so
      // this is a failed send, not a success with an audit line.
      console.error("re-invite answered a different user", {
        memberId,
        userId: invited.userId,
      });
      return refusal(
        "invite_failed",
        "Trimiterea invitației a eșuat. Reîncearcă.",
        502,
        origin,
      );
    }

    // The audit line. There is no profile-history table (role_history is
    // for Roles only), so the record is a `system` Notification to the
    // caller, as #773 allows. The email has left by now: a failed audit is
    // logged, not reported as a failed re-send.
    const changed = authChanges || profileChanges;
    try {
      await deps.notifyCaller(callerId, {
        title: "Invitație retrimisă",
        body:
          `Invitația pentru ${profile.fullName} a fost retrimisă la ${email}.` +
          (changed ? ` Adresa anterioară: ${profile.email}.` : ""),
        link: `/administrare/membri/${memberId}`,
      });
    } catch (error) {
      console.error("re-invite audit notification failed", error);
    }

    return json(
      { member_id: memberId, email, email_changed: changed },
      200,
      origin,
    );
  } catch (error) {
    console.error("reinvite-member failed", error);
    return json({ error: "Ceva n-a mers. Încearcă din nou." }, 500, origin);
  }
}
