// request-invitation — #968. An invited Member whose invitation email
// expired, or never arrived, gets a fresh one by typing their address on the
// login page and pressing "Trimite linkul": the login page calls this
// function when Auth answers `signup_disabled`, which is what Auth says to a
// magic-link request for an account that exists but was never confirmed.
//
// POST { email }                     from the app's own origin
//   202 { ok: true }     always, whatever the address: re-sent, nothing to
//                        re-send, too soon, or the send failed (logged). The
//                        answer never says whether the address has an account
//   400 invalid_json / invalid_body / email_invalid
//   403 origin_forbidden  no Origin header, or one not in ALLOWED_ORIGINS
//   405 method_not_allowed
//   429 rate_limited      this IP asked 20 or more times in the last hour
//   500 unexpected_error  the database could not be asked
//
// There is no JWT gate: a caller who has not signed in has no session, and
// the publishable key is not one (config.toml: verify_jwt = false). The two
// gates are the browser origin (_shared/cors.ts) and the database throttle,
// public.request_invitation_allowed: one request per address per minute,
// five per address per day, twenty per IP per hour, recorded as hashes only.
// The database also decides whether there is anything to send — an invited,
// unconfirmed, never-signed-in, activ account — so this function never
// creates, deletes or edits an account: it re-sends an invitation BC already
// made, under the project-wide email cap like every other email.
//
// Neither the address nor the caller's IP is ever logged. The IP reaches the
// database only as a hash (clientIpHash). The first x-forwarded-for entry is
// what the caller's own proxy chain says, so the per-IP cap is a brake on a
// careless script, not a wall; the per-address limits are what bound the
// email any one Member can be sent. The body is the same for every outcome;
// Auth's own /otp already tells an unconfirmed account from an unknown one,
// so a send's extra latency reveals nothing that endpoint does not.

import {
  corsHeaders,
  isAllowedOrigin,
  json,
  refusal,
} from "../_shared/cors.ts";
import type { RequestInvitationDeps } from "./deps.ts";

/** RFC 5321's limit on a forward path; the database refuses longer too. */
const MAX_EMAIL_LENGTH = 320;

interface RequestInvitationBody {
  email?: unknown;
}

/** The first non-empty entry of a comma-separated header, trimmed. */
function firstAddress(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim();
  return first ? first : null;
}

/**
 * The caller's IP as the database counts it: SHA-256 of the first address in
 * `cf-connecting-ip`, else `x-forwarded-for`, else `x-real-ip`, hex, its first
 * 32 characters. Null when no header names the caller (the per-IP cap then
 * does not apply; the per-address limits still do).
 */
export async function clientIpHash(req: Request): Promise<string | null> {
  const address = firstAddress(req.headers.get("cf-connecting-ip")) ??
    firstAddress(req.headers.get("x-forwarded-for")) ??
    firstAddress(req.headers.get("x-real-ip"));
  if (!address) return null;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(address),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("").slice(0, 32);
}

export async function handleRequestInvitation(
  req: Request,
  deps: RequestInvitationDeps,
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

  // The first gate, in place of a JWT: only the app's own pages may ask. A
  // request with no Origin at all is a script, not the login page.
  if (!isAllowedOrigin(origin)) {
    return refusal(
      "origin_forbidden",
      "Cererea nu vine din aplicație.",
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

  const body = parsed as RequestInvitationBody;
  const email = typeof body.email === "string"
    ? body.email.trim().toLowerCase()
    : "";
  if (!email || !email.includes("@") || email.length > MAX_EMAIL_LENGTH) {
    return refusal("email_invalid", "Email invalid.", 400, origin);
  }

  let verdict;
  try {
    verdict = await deps.verdict(email, await clientIpHash(req));
  } catch (error) {
    console.error("request-invitation: the database could not decide", error);
    return refusal(
      "unexpected_error",
      "Ceva n-a mers. Încearcă din nou.",
      500,
      origin,
    );
  }

  // The second gate. The only verdict the caller hears: it is about the
  // caller's IP, not about any address.
  if (verdict === "ip_limited") {
    return refusal(
      "rate_limited",
      "Prea multe cereri. Încearcă din nou mai târziu.",
      429,
      origin,
    );
  }

  if (verdict === "send") {
    try {
      await deps.inviteByEmail(email);
    } catch (error) {
      // Logged for the project's owners, answered like every other outcome:
      // a distinct answer here would say this address has an invitation.
      console.error(
        "request-invitation: the invitation was not re-sent",
        error,
      );
    }
  }

  return json({ ok: true }, 202, origin);
}
