// The port resend-webhook talks to the outside world through: its two
// settings, a clock, and the one database command. Tests inject a fake, so
// no test needs a database or a real signing secret.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseSecretKeys } from "../_shared/secret-keys.ts";

/** The Resend events this function acts on; every other type is a no-op. */
export type HandledEvent =
  | "email.bounced"
  | "email.complained"
  | "email.suppressed";

export interface ResendWebhookDeps {
  /**
   * The endpoint's signing secret (`whsec_...`) from the function secret
   * RESEND_WEBHOOK_SECRET, or "" when it is not set.
   */
  signingSecret(): string;
  /** Whether the project has a secret key to call the database with. */
  hasSecretKey(): boolean;
  /** Seconds since the epoch. */
  nowSeconds(): number;
  /**
   * public.notify_email_delivery_problem: the number of BC/Moderator
   * Notifications written (0 for an unknown address or one already reported
   * today). Throws on a database error.
   */
  notify(
    email: string,
    event: HandledEvent,
    reason: string | null,
  ): Promise<number>;
}

export function realDeps(): ResendWebhookDeps {
  // Read env per request rather than at module load, so importing this file
  // in a test never throws on a missing variable.
  const secretKeys = () =>
    parseSecretKeys(Deno.env.get("SUPABASE_SECRET_KEYS"));
  let admin: SupabaseClient | null = null;
  // The command is granted to service_role alone, which the gateway maps a
  // secret key (sb_secret_...) to (#796) -- never the legacy service_role JWT.
  const client = () =>
    admin ??= createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      secretKeys()[0] ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

  return {
    signingSecret: () => Deno.env.get("RESEND_WEBHOOK_SECRET") ?? "",
    hasSecretKey: () =>
      secretKeys().length > 0 && (Deno.env.get("SUPABASE_URL") ?? "") !== "",
    nowSeconds: () => Math.floor(Date.now() / 1000),
    async notify(email, event, reason) {
      const { data, error } = await client().rpc(
        "notify_email_delivery_problem",
        { p_email: email, p_event: event, p_reason: reason },
      );
      if (error) throw error;
      return typeof data === "number" ? data : 0;
    },
  };
}
