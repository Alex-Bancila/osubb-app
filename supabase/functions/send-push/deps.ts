// The handler talks to the outside world only through this port: the two
// outbox commands and one push transport. Tests inject a fake of all three,
// so no test ever opens a socket.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
// @ts-types="npm:@types/web-push@3.6.4"
import webpush from "web-push";

/** One claimed outbox row, as public.claim_push_deliveries returns it. */
export interface ClaimedDelivery {
  delivery_id: number;
  /** The attempt number this claim leased; settle must quote it back. */
  attempt: number;
  /** The browser's PushSubscription JSON, stored in push_tokens.token (#704). */
  token: string;
  notification_id: number;
  title: string;
  body: string | null;
  link: string | null;
}

export type Outcome = "sent" | "retry" | "dead" | "failed";

/** The row's status after settling, or null if it was no longer sending. */
export type Settled = "sent" | "pending" | "failed" | "dead" | null;

export interface PushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** The push service's HTTP answer. A network failure throws instead. */
export interface PushResponse {
  status: number;
  body: string;
}

/** Thrown by send() when the subscription's keys cannot be used at all. */
export class InvalidSubscriptionError extends Error {}

/** How long one push request, response body included, may take. */
export const SEND_TIMEOUT_MS = 20_000;

export interface SendPushDeps {
  /**
   * What is wrong with the function's configuration: the names of missing
   * settings, or of VAPID settings that are malformed -- never their values.
   */
  configProblems(): string[];
  claim(limit: number): Promise<ClaimedDelivery[]>;
  settle(
    id: number,
    attempt: number,
    outcome: Outcome,
    error: string | null,
  ): Promise<Settled>;
  send(
    subscription: PushSubscriptionJson,
    payload: string,
  ): Promise<PushResponse>;
}

const REQUIRED_ENV = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
];

export function realDeps(): SendPushDeps {
  // Read env per request rather than at module load, so importing this file
  // in a test never throws on a missing variable.
  const env = (name: string) => Deno.env.get(name) ?? "";
  let admin: SupabaseClient | null = null;
  const client = () =>
    admin ??= createClient(
      env("SUPABASE_URL"),
      env("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

  return {
    configProblems() {
      const missing = REQUIRED_ENV.filter((name) => env(name) === "");
      if (missing.length > 0) return missing;
      try {
        // Throws on a subject that is not mailto:/https:, or a key of the
        // wrong length. Checked before claiming: a malformed pair would
        // otherwise fail every row it touched.
        webpush.setVapidDetails(
          env("VAPID_SUBJECT"),
          env("VAPID_PUBLIC_KEY"),
          env("VAPID_PRIVATE_KEY"),
        );
      } catch {
        return [
          "VAPID_SUBJECT, VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY is malformed",
        ];
      }
      return [];
    },

    async claim(limit) {
      const { data, error } = await client().rpc("claim_push_deliveries", {
        p_limit: limit,
      });
      if (error) throw error;
      return (data ?? []) as ClaimedDelivery[];
    },

    async settle(id, attempt, outcome, error) {
      const { data, error: rpcError } = await client().rpc(
        "settle_push_delivery",
        { p_id: id, p_attempt: attempt, p_outcome: outcome, p_error: error },
      );
      if (rpcError) throw rpcError;
      return (data ?? null) as Settled;
    },

    async send(subscription, payload) {
      // web-push does the RFC 8291 encryption and the RFC 8292 VAPID
      // signature; fetch does the transport. sendNotification would use
      // node:https, which only speaks https and hides the response behind an
      // error type -- fetch is the edge runtime's native client.
      let request: ReturnType<typeof webpush.generateRequestDetails>;
      try {
        request = webpush.generateRequestDetails(subscription, payload, {
          vapidDetails: {
            subject: env("VAPID_SUBJECT"),
            publicKey: env("VAPID_PUBLIC_KEY"),
            privateKey: env("VAPID_PRIVATE_KEY"),
          },
        });
      } catch (cause) {
        // configProblems() has already vetted the VAPID settings, so what
        // is left to reject here is the subscription itself.
        throw new InvalidSubscriptionError(
          cause instanceof Error ? cause.message : String(cause),
        );
      }
      const response = await fetch(request.endpoint, {
        method: request.method,
        headers: request.headers,
        // A copy typed Uint8Array<ArrayBuffer>, which fetch accepts as BodyInit.
        body: request.body ? new Uint8Array(request.body) : null,
        // A push service answers directly; following a redirect would send
        // the signed request somewhere the subscription never named.
        redirect: "error",
        // Bounds the request and the body read below, so one hung push
        // service cannot hold the batch past its lease. A timeout throws and
        // is retried like any network error.
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      return { status: response.status, body: await response.text() };
    },
  };
}
