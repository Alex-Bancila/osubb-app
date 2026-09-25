// The handler talks to the outside world only through this port: the two
// outbox commands and one push transport. Tests inject a fake of all three,
// so no test ever opens a socket.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Buffer } from "node:buffer";
import { createECDH } from "node:crypto";
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
   * The project's secret keys (`sb_secret_...`), any of which the caller
   * must send on the `apikey` header. Empty when the platform provides none.
   */
  secretKeys(): string[];
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
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
];

/**
 * The secret keys in `SUPABASE_SECRET_KEYS`, the platform's JSON map of key
 * name to `sb_secret_` key (`{"default": "sb_secret_..."}`), `default`
 * first. The platform injects it into every function, locally too, and a
 * function secret cannot be named `SUPABASE_*`, so there is nothing to set by
 * hand (#769). Anything unreadable is no key at all.
 */
export function parseSecretKeys(raw: string | undefined): string[] {
  if (!raw) return [];
  let map: unknown;
  try {
    map = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof map !== "object" || map === null || Array.isArray(map)) return [];
  return Object.entries(map as Record<string, unknown>)
    .filter((entry): entry is [string, string] =>
      typeof entry[1] === "string" && entry[1] !== ""
    )
    .sort(([a], [b]) => Number(b === "default") - Number(a === "default"))
    .map(([, key]) => key);
}

/** The base64url uncompressed P-256 public key of a base64url private key. */
function publicKeyOf(privateKey: string): string {
  const ecdh = createECDH("prime256v1");
  // Buffers, not (string, encoding): the edge runtime's node:crypto only
  // takes the former.
  ecdh.setPrivateKey(Buffer.from(privateKey, "base64url"));
  return Buffer.from(ecdh.getPublicKey()).toString("base64url");
}

export function realDeps(): SendPushDeps {
  // Read env per request rather than at module load, so importing this file
  // in a test never throws on a missing variable.
  const env = (name: string) => Deno.env.get(name) ?? "";
  const secretKeys = () =>
    parseSecretKeys(Deno.env.get("SUPABASE_SECRET_KEYS"));
  let admin: SupabaseClient | null = null;
  // The outbox commands are granted to service_role, which the gateway maps
  // a secret key to -- the same key the caller had to present, not the
  // legacy service_role JWT that Supabase retires by the end of 2026.
  const client = () =>
    admin ??= createClient(
      env("SUPABASE_URL"),
      secretKeys()[0] ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

  return {
    secretKeys,

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
      // Each key can be well formed and still come from different pairs; the
      // push service would then refuse every signature with a 401/403.
      let derived: string | null = null;
      try {
        derived = publicKeyOf(env("VAPID_PRIVATE_KEY"));
      } catch (cause) {
        console.error("VAPID public key derivation failed", cause);
      }
      if (derived !== env("VAPID_PUBLIC_KEY")) {
        return ["VAPID_PUBLIC_KEY does not match VAPID_PRIVATE_KEY"];
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
