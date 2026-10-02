// The port send-invitations talks to the outside world through (#991), and
// its real wiring: reinvite-member's reads of a Member's Auth account and
// Profile, an invitation send that keeps Auth's error code (the rate-limit
// stop reads it), and the invited_at stamp. Since #997 also reinvite-member's
// address check and Auth address move, so a never-invited Member whose address
// BC corrected in the "De invitat" grid is mailed at the corrected one. No
// createUser, no deleteUser: this function never creates or removes an account.

import { createClient } from "@supabase/supabase-js";
import type { AdminEnv, ClientFactory } from "../invite-member/deps.ts";
import {
  type AuthAccount,
  type AuthError,
  type MemberProfile,
  realDeps as reinviteDeps,
} from "../reinvite-member/deps.ts";

export { readAdminEnv } from "../invite-member/deps.ts";

export interface SendError {
  message: string;
  status?: number;
  /** Auth's error code, e.g. `over_email_send_rate_limit`. */
  code?: string;
}

export interface SendInvitationsDeps {
  callerId(): Promise<string | null>;
  memberLevel(userId: string): Promise<number>;
  authAccount(memberId: string): Promise<AuthAccount | null>;
  profile(memberId: string): Promise<MemberProfile | null>;
  /** True when a profile OTHER than this Member's uses the address (any case). */
  emailTaken(email: string, memberId: string): Promise<boolean>;
  /** Moves the Auth user to a new address (admin API: no confirmation mail). */
  setAuthEmail(memberId: string, email: string): Promise<{ error?: AuthError }>;
  /** Sends the invitation to an existing, unconfirmed account. */
  inviteByEmail(email: string): Promise<{ userId?: string; error?: SendError }>;
  /** public.record_invitation_sent: the stamp, as Postgres recorded it. */
  recordInvitationSent(memberId: string): Promise<string>;
  /** Milliseconds; injectable so the time budget is testable. */
  now(): number;
}

export function realDeps(
  req: Request,
  env: AdminEnv,
  create: ClientFactory = createClient,
): SendInvitationsDeps {
  const reads = reinviteDeps(req, env, create);
  const admin = create(env.url, env.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return {
    callerId: () => reads.callerId(),
    memberLevel: (userId) => reads.memberLevel(userId),
    authAccount: (memberId) => reads.authAccount(memberId),
    profile: (memberId) => reads.profile(memberId),
    emailTaken: (email, memberId) => reads.emailTaken(email, memberId),
    setAuthEmail: (memberId, email) => reads.setAuthEmail(memberId, email),

    async inviteByEmail(email) {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email);
      if (error || !data?.user) {
        return {
          error: {
            message: error?.message ?? "invite failed",
            status: error?.status,
            code: error?.code,
          },
        };
      }
      return { userId: data.user.id };
    },

    async recordInvitationSent(memberId) {
      const { data, error } = await admin.rpc("record_invitation_sent", {
        p_member_id: memberId,
      });
      if (error) throw error;
      return data as string;
    },

    now: () => Date.now(),
  };
}
