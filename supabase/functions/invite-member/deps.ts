// The handler talks to the outside world only through this interface.
//
// Why a port rather than passing the Supabase clients around: the three bugs
// this function shipped with were all about *ordering* — did we call Auth
// before checking for a duplicate, did we delete a user we shouldn't have.
// Testing that needs to observe which calls happen and in what order, which
// is painful against a query-builder chain and trivial against six methods.
// The CSV import (#72) will reuse the same port.

import {
  createClient,
  type SupabaseClient,
  type SupabaseClientOptions,
} from "@supabase/supabase-js";
import type { InviteDeps } from "../_shared/member-invite.ts";
import { allActiveGroups, type GroupReference } from "../_shared/groups.ts";
import { requireSecretKey } from "../_shared/secret-keys.ts";

export type {
  DbError,
  InviteDeps,
  ProvisionArgs,
} from "../_shared/member-invite.ts";

export interface InviteAdminDeps extends InviteDeps {
  /** Every active Group, loaded once per CSV import for name resolution. */
  activeGroups(): Promise<GroupReference[]>;
}

/** What the two clients are built from, read once when the function boots. */
export interface AdminEnv {
  url: string;
  /** Validates the caller's token; never used for anything privileged. */
  anonKey: string;
  /** The project's secret key (`sb_secret_...`) the admin client uses. */
  secretKey: string;
}

/**
 * Reads the function's environment at boot. The admin client is built from
 * the project's secret key in `SUPABASE_SECRET_KEYS` (#796, ruling L8), never
 * from the legacy service_role key variable, which Supabase retires by the
 * end of 2026. Throws MissingSecretKeyError when there is no secret key, so
 * the function refuses to start rather than fail every invitation.
 */
export function readAdminEnv(
  functionName: string,
  get: (name: string) => string | undefined = (name) => Deno.env.get(name),
): AdminEnv {
  return {
    url: get("SUPABASE_URL") ?? "",
    anonKey: get("SUPABASE_ANON_KEY") ?? "",
    secretKey: requireSecretKey(get("SUPABASE_SECRET_KEYS"), functionName),
  };
}

export type ClientFactory = (
  url: string,
  key: string,
  options?: SupabaseClientOptions<"public">,
) => SupabaseClient;

export function realDeps(
  req: Request,
  env: AdminEnv,
  create: ClientFactory = createClient,
): InviteAdminDeps {
  const authHeader = req.headers.get("Authorization") ?? "";

  // Anon client + the caller's header: validates the token against Auth.
  const caller = create(env.url, env.anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  // The secret key maps to service_role at the gateway, so this client
  // bypasses RLS and is never handed a client-supplied filter — every query
  // below is keyed off the validated user id or a value the handler has
  // already checked.
  const admin = create(env.url, env.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return {
    async callerId() {
      const { data: { user }, error } = await caller.auth.getUser();
      return error || !user ? null : user.id;
    },

    async memberLevel(userId) {
      const { data, error } = await admin.rpc("member_level", {
        p_member: userId,
      });
      if (error) throw error;
      return data ?? 0;
    },

    async missingGroupIds(ids) {
      if (ids.length === 0) return [];
      // Archived Groups are deliberately NOT filtered out here: the
      // Appointment core answers an archived Group with its own reason, and
      // reporting it as "inexistent" would tell a BC to fix the wrong thing.
      const { data, error } = await admin.from("groups").select("id").in(
        "id",
        ids,
      );
      if (error) throw error;
      return ids.filter((id) => !data?.some((row) => row.id === id));
    },

    activeGroups() {
      return allActiveGroups(async (from, to) => {
        const { data, error } = await admin.from("groups")
          .select("id, name, short, path")
          .eq("status", "active")
          .order("id", { ascending: true })
          .range(from, to);
        if (error) throw error;
        return (data ?? []).map((row) => ({
          id: row.id,
          name: row.name,
          short: row.short,
          path: row.path ?? [row.id],
        }));
      });
    },

    async profileExists(email) {
      const { data, error } = await admin
        .from("profiles").select("id").eq("email", email).maybeSingle();
      if (error) throw error;
      return data !== null;
    },

    async inviteByEmail(email) {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email);
      if (error || !data?.user) {
        return {
          error: {
            message: error?.message ?? "invite failed",
            status: error?.status,
          },
        };
      }
      return { userId: data.user.id };
    },

    async provision(args) {
      const { error } = await admin.rpc("provision_profile", {
        p_user_id: args.userId,
        p_full_name: args.fullName,
        p_email: args.email,
        p_role: args.role,
        p_group_ids: args.groupIds,
        p_appointed_by: args.appointedBy,
      });
      return { error: error ?? undefined };
    },

    async deleteUser(userId) {
      await admin.auth.admin.deleteUser(userId);
    },
  };
}
