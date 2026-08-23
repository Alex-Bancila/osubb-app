// invite-member — Epic 2.3b.
// The only way an OSUBB account comes into existence (ADR-0003): BC sends a
// magic-link invite, and the member is provisioned in the same request.
// Spec §5.1. The CSV import (#72) reuses this same path, one row at a time.
//
// POST { email, full_name, role?, dept_ids?, team_ids? }
//   201 { user_id }        invited and provisioned
//   400                    bad input
//   401 / 403              not signed in / not BC (level < 6)
//   409                    that email already has an account
//
// Authorization deliberately reads the caller's level from the DATABASE, not
// from their JWT claims: a token issued before a demotion still carries the
// old level for up to an hour, and this endpoint creates accounts.

import { createClient } from "@supabase/supabase-js";
import { corsHeaders, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const INVITE_LEVEL = 6; // BC and above — capability manageRoles (spec §4.1)

interface InviteRequest {
  email?: string;
  full_name?: string;
  role?: string;
  dept_ids?: string[];
  team_ids?: string[];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "Autentifică-te pentru a invita membri." }, 401);
  }

  // Who is calling? The anon client validates the token against Auth.
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await caller.auth.getUser();
  if (authError || !user) {
    return json({ error: "Sesiune invalidă sau expirată." }, 401);
  }

  // Service client: bypasses RLS, so it must never be handed a client-supplied
  // filter. Everything below is keyed off the validated user id.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // member_level() answers 0 for anyone missing, inactive or unprovisioned,
  // so one comparison covers every "not allowed" case.
  const { data: callerLevel, error: levelError } = await admin
    .rpc("member_level", { p_member: user.id });

  if (levelError) {
    console.error("caller lookup failed", levelError);
    return json({ error: "Nu am putut verifica permisiunile." }, 500);
  }
  if ((callerLevel ?? 0) < INVITE_LEVEL) {
    return json({ error: "Doar BC poate invita membri." }, 403);
  }

  let body: InviteRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Corp de cerere invalid (JSON)." }, 400);
  }

  const email = body.email?.trim().toLowerCase();
  const fullName = body.full_name?.trim();
  if (!email || !email.includes("@")) return json({ error: "Email invalid." }, 400);
  if (!fullName) return json({ error: "Numele este obligatoriu." }, 400);

  // 0a · do the departments and teams exist?
  // provision_profile enforces this atomically anyway, but checking first
  // means a typo never sends an invitation email to a real person whose
  // account we then delete. It matters most for the CSV import (#72), where
  // one bad cell shouldn't email anybody.
  const deptIds = body.dept_ids ?? [];
  const teamIds = body.team_ids ?? [];
  for (const [table, ids, label] of [
    ["departments", deptIds, "Departament inexistent"],
    ["teams", teamIds, "Echipă inexistentă"],
  ] as const) {
    if (ids.length === 0) continue;
    const { data: found, error } = await admin.from(table).select("id").in("id", ids);
    if (error) {
      console.error(`${table} lookup failed`, error);
      return json({ error: "Nu am putut valida datele membrului." }, 500);
    }
    const missing = ids.filter((id) => !found?.some((row) => row.id === id));
    if (missing.length > 0) {
      return json({ error: `${label}: ${missing.join(", ")}.` }, 400);
    }
  }

  // 0b · does this person already exist?
  // This check is load-bearing, not a nicety. inviteUserByEmail does NOT fail
  // for a known address — it returns the existing user — so without it the
  // provisioning step below fails on the primary key and the compensation
  // deletes a real member's auth row, taking their profile and points ledger
  // with it. Re-inviting a colleague must never be destructive.
  const { data: existing, error: existingError } = await admin
    .from("profiles").select("id").eq("email", email).maybeSingle();

  if (existingError) {
    console.error("duplicate check failed", existingError);
    return json({ error: "Nu am putut verifica adresa." }, 500);
  }
  if (existing) {
    return json({ error: `${email} are deja cont.`, code: "already_exists" }, 409);
  }

  // 1 · the magic-link invite creates the auth user and emails them.
  const { data: invited, error: inviteError } = await admin.auth.admin
    .inviteUserByEmail(email);

  if (inviteError || !invited?.user) {
    const alreadyExists = inviteError?.status === 422 ||
      /already been registered|already exists/i.test(inviteError?.message ?? "");
    if (alreadyExists) {
      return json({ error: `${email} are deja cont.`, code: "already_exists" }, 409);
    }
    console.error("invite failed", inviteError);
    return json({ error: "Trimiterea invitației a eșuat." }, 502);
  }

  // 2 · provisioning — one atomic call (profile + departments + teams).
  const { error: provisionError } = await admin.rpc("provision_profile", {
    p_user_id: invited.user.id,
    p_full_name: fullName,
    p_email: email,
    p_role: body.role ?? "recrut",
    p_dept_ids: deptIds,
    p_team_ids: teamIds,
  });

  if (provisionError) {
    // A unique violation here means someone else provisioned this address
    // between the check above and now. Their profile is the real one — leave
    // the auth user alone and report the conflict.
    if (provisionError.code === "23505") {
      return json({ error: `${email} are deja cont.`, code: "already_exists" }, 409);
    }

    // Otherwise the data was bad (unknown department or team) and the auth
    // user we just created has no profile. The two steps cannot share a
    // transaction — one is the Auth API, the other the database — so undo the
    // half that succeeded, or the address is burned: re-inviting would find a
    // user with nothing to log into.
    await admin.auth.admin.deleteUser(invited.user.id);
    console.error("provisioning failed, invite rolled back", provisionError);
    return json({
      error: "Datele membrului nu sunt valide (departament sau echipă inexistentă).",
      details: provisionError.message,
    }, 400);
  }

  return json({ user_id: invited.user.id, email }, 201);
});
