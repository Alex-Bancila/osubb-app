// The port reinvite-member talks to the outside world through, and its real
// wiring. Same shape as invite-member's (#57): the handler's ORDER is what
// matters — refuse a signed-in Member before anything changes, change the
// address before inviting, never delete an account — and a port of small
// methods is what lets handler.test.ts observe that order.
//
// There is deliberately no `deleteUser` here. invite-member needs one to roll
// back an invitation it just created; this function never creates an account,
// so it has nothing to delete, and a port without the method cannot be edited
// into calling it by accident (#773).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AdminEnv, ClientFactory } from "../invite-member/deps.ts";
import type { DbError } from "../_shared/member-invite.ts";

export { readAdminEnv } from "../invite-member/deps.ts";
export type { AdminEnv, ClientFactory, DbError };

/** The Auth side of a Member: the sign-in address and whether it was used. */
export interface AuthAccount {
  email: string;
  /** `auth.users.last_sign_in_at`; null for a Member who never signed in. */
  lastSignInAt: string | null;
  /** Whether the address is confirmed; an invitation needs it unconfirmed. */
  emailConfirmed: boolean;
}

/** The profile side of a Member, as the admin client reads it. */
export interface MemberProfile {
  email: string;
  fullName: string;
  status: string;
}

export type AuthError = DbError & { status?: number };

/** The audit Notification: a title, a body and the in-app route it opens. */
export interface CallerNotice {
  title: string;
  body: string;
  link: string;
}

export interface ReinviteDeps {
  /** Validated id of the caller, or null when the token is missing/invalid. */
  callerId(): Promise<string | null>;
  /** Authoritative level from the database; 0 for missing/inactive members. */
  memberLevel(userId: string): Promise<number>;
  /** The Member's Auth user, or null when there is none. */
  authAccount(memberId: string): Promise<AuthAccount | null>;
  /** The Member's profile, or null when there is none. */
  profile(memberId: string): Promise<MemberProfile | null>;
  /** True when a profile OTHER than this Member's already uses the address. */
  emailTaken(email: string, memberId: string): Promise<boolean>;
  /** Moves the Auth user to a new address (no confirmation: admin API). */
  setAuthEmail(memberId: string, email: string): Promise<{ error?: AuthError }>;
  /** Writes `profiles.email` for this Member. */
  setProfileEmail(
    memberId: string,
    email: string,
  ): Promise<{ error?: DbError }>;
  /** Sends the invitation email again for the existing, unconfirmed user. */
  inviteByEmail(email: string): Promise<{ userId?: string; error?: AuthError }>;
  /** A `system` Notification to the caller: the audit line of the re-send. */
  notifyCaller(callerId: string, notice: CallerNotice): Promise<void>;
}

export function realDeps(
  req: Request,
  env: AdminEnv,
  create: ClientFactory = createClient,
): ReinviteDeps {
  const authHeader = req.headers.get("Authorization") ?? "";

  // Anon client + the caller's header: validates the token against Auth.
  const caller = create(env.url, env.anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  // The secret key maps to service_role at the gateway (#796): this client
  // bypasses RLS and reads auth.users through the Auth admin API. Every query
  // below is keyed off the validated caller id or a member id the handler has
  // already checked is a uuid.
  const admin: SupabaseClient = create(env.url, env.secretKey, {
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

    async authAccount(memberId) {
      const { data, error } = await admin.auth.admin.getUserById(memberId);
      if (error?.status === 404) return null;
      if (error) throw error;
      if (!data?.user) return null;
      return {
        email: data.user.email ?? "",
        lastSignInAt: data.user.last_sign_in_at ?? null,
        emailConfirmed: Boolean(data.user.email_confirmed_at),
      };
    },

    async profile(memberId) {
      const { data, error } = await admin.from("profiles")
        .select("email, full_name, status")
        .eq("id", memberId)
        .maybeSingle();
      if (error) throw error;
      return data
        ? { email: data.email, fullName: data.full_name, status: data.status }
        : null;
    },

    async emailTaken(email, memberId) {
      const { data, error } = await admin.from("profiles")
        .select("id")
        // Case-insensitive, with the pattern characters escaped: a profile
        // written in mixed case still names the same mailbox.
        .ilike("email", email.replace(/[\\%_]/g, "\\$&"))
        .neq("id", memberId)
        .limit(1);
      if (error) throw error;
      return (data ?? []).length > 0;
    },

    async setAuthEmail(memberId, email) {
      const { error } = await admin.auth.admin.updateUserById(memberId, {
        email,
      });
      return error
        ? { error: { message: error.message, status: error.status } }
        : {};
    },

    async setProfileEmail(memberId, email) {
      // `.single()` requires the row back, so an update that touched nothing
      // is a failure the handler rolls back, not a silent success.
      const { error } = await admin.from("profiles")
        .update({ email })
        .eq("id", memberId)
        .select("id")
        .single();
      return error
        ? { error: { code: error.code, message: error.message } }
        : {};
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

    async notifyCaller(callerId, notice) {
      const { error } = await admin.from("notifications").insert({
        member_id: callerId,
        kind: "system",
        title: notice.title,
        body: notice.body,
        link: notice.link,
      });
      if (error) throw error;
    },
  };
}
