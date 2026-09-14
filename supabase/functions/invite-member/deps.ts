// The handler talks to the outside world only through this interface.
//
// Why a port rather than passing the Supabase clients around: the three bugs
// this function shipped with were all about *ordering* — did we call Auth
// before checking for a duplicate, did we delete a user we shouldn't have.
// Testing that needs to observe which calls happen and in what order, which
// is painful against a query-builder chain and trivial against six methods.
// The CSV import (#72) will reuse the same port.

import { createClient } from "@supabase/supabase-js";
import type { InviteDeps } from "../_shared/member-invite.ts";

export type {
  DbError,
  InviteDeps,
  ProvisionArgs,
} from "../_shared/member-invite.ts";

export interface InviteAdminDeps extends InviteDeps {
  /** All currently valid ids, loaded once for CSV validation. */
  referenceIds(table: "departments" | "teams"): Promise<string[]>;
}

export function realDeps(req: Request): InviteAdminDeps {
  // Read env here rather than at module load, so importing this file in a
  // test (or from another function) never throws on a missing variable.
  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";

  // Anon client + the caller's header: validates the token against Auth.
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  // Service client bypasses RLS, so it is never handed a client-supplied
  // filter — every query below is keyed off the validated user id or a value
  // the handler has already checked.
  const admin = createClient(url, serviceKey, {
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

    async missingIds(table, ids) {
      if (ids.length === 0) return [];
      const { data, error } = await admin.from(table).select("id").in(
        "id",
        ids,
      );
      if (error) throw error;
      return ids.filter((id) => !data?.some((row) => row.id === id));
    },

    async referenceIds(table) {
      const { data, error } = await admin.from(table).select("id");
      if (error) throw error;
      return data?.map((row) => row.id) ?? [];
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
        p_dept_ids: args.deptIds,
        p_team_ids: args.teamIds,
      });
      return { error: error ?? undefined };
    },

    async deleteUser(userId) {
      await admin.auth.admin.deleteUser(userId);
    },
  };
}
