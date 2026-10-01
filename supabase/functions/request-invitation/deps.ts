// The port request-invitation talks to the outside world through, and its
// real wiring: one database question and one Auth call. Same shape as
// reinvite-member's (#773) — a port of small methods is what lets
// handler.test.ts observe that the email leaves only on the database's say-so.
//
// Like reinvite-member, there is deliberately no `deleteUser`, `createUser`
// or `generateLink` here, and no profile write: this function never creates
// or removes an account, it only re-sends an invitation that already exists
// (#968), and a port without those methods cannot be edited into calling
// them by accident.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AdminEnv, ClientFactory } from "../invite-member/deps.ts";

export { readAdminEnv } from "../invite-member/deps.ts";
export type { AdminEnv, ClientFactory };

/**
 * What `public.request_invitation_allowed` decides:
 *   send        an invited, unconfirmed, never-signed-in, activ account under
 *               its limits — re-send its invitation
 *   skip        anything else about the address (unknown, confirmed,
 *               signed in, inactive) — one word for all
 *   cooldown    the address was asked for in the last 60 seconds, or five
 *               times in the last 24 hours
 *   ip_limited  the caller's IP hash asked 20 or more times in the last hour
 */
export type Verdict = "send" | "skip" | "cooldown" | "ip_limited";

const VERDICTS: readonly string[] = ["send", "skip", "cooldown", "ip_limited"];

export interface RequestInvitationDeps {
  /**
   * public.request_invitation_allowed(email, ipHash): records the request
   * (hashes only) and answers whether to send. Throws on a database error,
   * and on an answer outside {@link Verdict}.
   */
  verdict(email: string, ipHash: string | null): Promise<Verdict>;
  /**
   * Re-sends the invitation email of the existing, unconfirmed account at
   * this address (a new token, the "Ai fost invitat" template). Throws when
   * Auth refuses.
   */
  inviteByEmail(email: string): Promise<void>;
}

export function realDeps(
  env: AdminEnv,
  create: ClientFactory = createClient,
): RequestInvitationDeps {
  // The secret key maps to service_role at the gateway (#796): the only role
  // that may execute request_invitation_allowed, and the one the Auth admin
  // API needs. There is no caller client: nobody is signed in yet.
  const admin: SupabaseClient = create(env.url, env.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return {
    async verdict(email, ipHash) {
      const { data, error } = await admin.rpc("request_invitation_allowed", {
        p_email: email,
        p_ip_hash: ipHash,
      });
      if (error) throw error;
      if (typeof data !== "string" || !VERDICTS.includes(data)) {
        throw new Error(
          `request_invitation_allowed answered an unknown verdict: ${
            JSON.stringify(data)
          }`,
        );
      }
      return data as Verdict;
    },

    async inviteByEmail(email) {
      // Exactly as reinvite-member re-sends: Auth re-sends the invitation to
      // an existing user whose address is not yet confirmed, keeping the user
      // (and so the profile id) as it is.
      const { error } = await admin.auth.admin.inviteUserByEmail(email);
      if (error) throw error;
    },
  };
}
