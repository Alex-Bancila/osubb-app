// The port send-digest talks to the outside world through: its settings, the
// two outbox commands, the Resend API and a pause between sends. Tests
// inject a fake of all of it, so no test opens a socket or needs a database.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { appOrigin } from "../_shared/app-links.ts";
import { parseSecretKeys } from "../_shared/secret-keys.ts";
import type { DigestItem } from "./render.ts";

/** One claimed digest, as public.claim_email_digests returns it. */
export interface ClaimedDigest {
  digest_id: number;
  /** The attempt number this claim leased; settle must quote it back. */
  attempt: number;
  email: string;
  member_name: string;
  unread_count: number;
  items: DigestItem[];
}

export type DigestOutcome = "sent" | "retry" | "deferred" | "failed";

/** The row's status after settling, or null if it was no longer sending. */
export type DigestSettled = "sent" | "pending" | "failed" | null;

/** One email, in the shape the Resend API takes. */
export interface EmailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Resend keeps it 24 hours: the same digest is never accepted twice. */
  idempotencyKey: string;
}

/** Resend's HTTP answer (its first 1 KB). A network failure throws instead. */
export interface ProviderResponse {
  status: number;
  body: string;
}

export interface SendDigestDeps {
  /** The project's secret keys, one of which the caller must send on apikey. */
  secretKeys(): string[];
  /** Names of missing or malformed settings -- never their values. */
  configProblems(): string[];
  /** The app's https origin, or null when ALLOWED_ORIGINS gives none. */
  appOrigin(): string | null;
  /** The From header: EMAIL_FROM, or OSUBB <noreply@app.osubb.ro>. */
  sender(): string;
  claim(limit: number): Promise<ClaimedDigest[]>;
  settle(
    id: number,
    attempt: number,
    outcome: DigestOutcome,
    error: string | null,
    providerId: string | null,
  ): Promise<DigestSettled>;
  send(message: EmailMessage): Promise<ProviderResponse>;
  /** Waits between two sends (Resend allows two requests a second). */
  pause(ms: number): Promise<void>;
}

export const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** The sender of ruling L5; staging sets EMAIL_FROM to "OSUBB staging <...>". */
export const DEFAULT_SENDER = "OSUBB <noreply@app.osubb.ro>";

/** How long one Resend request, response body included, may take. */
export const SEND_TIMEOUT_MS = 15_000;

/** How much of Resend's answer is read: enough for its id or its error. */
export const MAX_RESPONSE_BODY_BYTES = 1024;

/**
 * A From header Resend accepts and nobody can smuggle a second header
 * through: `Name <address>` or a bare address, one line.
 */
export function isSender(value: string): boolean {
  return /^([^<>\r\n"]{1,80} <)?[^\s<>@"]+@[^\s<>@"]+(>)?$/.test(value) &&
    value.includes("<") === value.endsWith(">");
}

/** The first `limit` bytes of a response body; the rest is cancelled unread. */
export async function readCapped(
  response: Response,
  limit = MAX_RESPONSE_BODY_BYTES,
): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const kept = new Uint8Array(limit);
  let length = 0;
  try {
    while (length < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = value.subarray(0, limit - length);
      kept.set(take, length);
      length += take.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return new TextDecoder().decode(kept.subarray(0, length));
}

/** POST one email to Resend: no redirect, a timeout, a capped answer. */
export async function postToResend(
  apiKey: string,
  message: EmailMessage,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = SEND_TIMEOUT_MS,
): Promise<ProviderResponse> {
  const response = await fetchImpl(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": message.idempotencyKey,
    },
    body: JSON.stringify({
      from: message.from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: response.status, body: await readCapped(response) };
}

export function realDeps(): SendDigestDeps {
  // Read env per request rather than at module load, so importing this file
  // in a test never throws on a missing variable.
  const env = (name: string) => Deno.env.get(name) ?? "";
  const secretKeys = () =>
    parseSecretKeys(Deno.env.get("SUPABASE_SECRET_KEYS"));
  const sender = () => env("EMAIL_FROM").trim() || DEFAULT_SENDER;
  let admin: SupabaseClient | null = null;
  // The outbox commands are granted to service_role, which the gateway maps
  // a secret key to -- the same key the caller had to present (#796).
  const client = () =>
    admin ??= createClient(env("SUPABASE_URL"), secretKeys()[0] ?? "", {
      auth: { autoRefreshToken: false, persistSession: false },
    });

  return {
    secretKeys,
    appOrigin,
    sender,

    configProblems() {
      const problems: string[] = [];
      if (env("SUPABASE_URL") === "") problems.push("SUPABASE_URL");
      if (env("RESEND_API_KEY") === "") problems.push("RESEND_API_KEY");
      if (appOrigin() === null) {
        problems.push("ALLOWED_ORIGINS (no https app origin first)");
      }
      if (!isSender(sender())) problems.push("EMAIL_FROM is malformed");
      return problems;
    },

    async claim(limit) {
      const { data, error } = await client().rpc("claim_email_digests", {
        p_limit: limit,
      });
      if (error) throw error;
      return (data ?? []) as ClaimedDigest[];
    },

    async settle(id, attempt, outcome, error, providerId) {
      const { data, error: rpcError } = await client().rpc(
        "settle_email_digest",
        {
          p_id: id,
          p_attempt: attempt,
          p_outcome: outcome,
          p_error: error,
          p_provider_id: providerId,
        },
      );
      if (rpcError) throw rpcError;
      return (data ?? null) as DigestSettled;
    },

    send: (message) => postToResend(env("RESEND_API_KEY"), message),

    pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}
