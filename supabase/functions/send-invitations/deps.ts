// The port send-invitations talks to the outside world through (#991), and
// its real wiring: reinvite-member's reads of a Member's Auth account and
// Profile, its address lookup and Auth move (the sender mails the Profile's
// address, so Auth follows a correction made in the De invitat grid), an
// invitation send that keeps Auth's error code (the rate-limit stop reads
// it), and the invited_at stamp. No createUser, no deleteUser: this function
// only ever moves an address and sends.

import { createClient } from "@supabase/supabase-js";
import type { AdminEnv, ClientFactory } from "../invite-member/deps.ts";
import {
  type AuthAccount,
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
  /** True when a profile OTHER than this Member's already uses the address. */
  emailTaken(email: string, memberId: string): Promise<boolean>;
  /** Moves the Auth user to a new address (no confirmation: admin API). */
  setAuthEmail(memberId: string, email: string): Promise<{ error?: SendError }>;
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
