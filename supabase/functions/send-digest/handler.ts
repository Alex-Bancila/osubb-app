// send-digest -- #775, ruling L20.
// Sends the Email Digest outbox (private.email_digests) through the Resend
// API. Called by the hourly pg_cron job osubb-email-digest through pg_net,
// and only when a digest is due and today's quota is not spent; nothing else
// should call it.
//
// POST (the body is never read)
//   200 { claimed, sent, retried, deferred, failed }
//   401  the apikey header is not one of the project's secret keys
//   405  not POST
//   413  a declared body over 1 KB
//   500  a setting is missing or malformed (named, never its value), or a
//        claim failed
//   502  Resend refused the API key or the sender (401/403): nothing more is
//        sent this run and every claimed digest waits for the next morning
//
// The quota guard is the claim: public.claim_email_digests never hands out
// more digests than org_settings.email_daily_quota minus those already sent
// (or being sent) today. Resend's own quota answer (429 daily or monthly
// quota) defers the digest to the next morning and stops the run too.
//
// Outcomes per Resend answer:
//   2xx                     -> sent (Resend's id kept)
//   429 quota / 401 / 403   -> deferred to 07:00 Bucharest the next day, and
//                              the rest of the run is deferred unsent
//   429 rate limit / 5xx /
//   network                 -> retry one, then two hours later; the third
//                              failure is failed
//   anything else (400/409/
//   422)                    -> failed at once; 409 is Resend's idempotency
//                              guard (an earlier attempt of this digest
//                              reached it), so there is never a second email

import { isSecretKey } from "../_shared/secret-keys.ts";
import type {
  ClaimedDigest,
  DigestOutcome,
  ProviderResponse,
  SendDigestDeps,
} from "./deps.ts";
import { renderDigest } from "./render.ts";

export const BATCH_SIZE = 20;
/** At most 100 emails a run: with the pause, well inside the cron's 150 s. */
export const MAX_BATCHES = 5;
/** Resend allows two requests a second per team. */
export const SEND_GAP_MS = 600;
/** The cron sends `{}`; anything longer is not the cron. */
export const MAX_BODY_BYTES = 1024;

export interface SendDigestSummary {
  claimed: number;
  sent: number;
  retried: number;
  deferred: number;
  failed: number;
}

/** Why a run stopped sending: Resend's quota, or a key/sender it refused. */
export type StopReason = "provider_quota" | "provider_auth";

export interface Classified {
  outcome: DigestOutcome;
  stop: StopReason | null;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorName(body: string): string | null {
  try {
    const value = JSON.parse(body);
    return typeof value?.name === "string" ? value.name : null;
  } catch {
    return null;
  }
}

/** What one Resend answer means for the digest and for the rest of the run. */
export function classify(response: ProviderResponse): Classified {
  const { status } = response;
  if (status >= 200 && status < 300) return { outcome: "sent", stop: null };
  if (status === 429) {
    const name = errorName(response.body);
    if (name === "daily_quota_exceeded" || name === "monthly_quota_exceeded") {
      return { outcome: "deferred", stop: "provider_quota" };
    }
    return { outcome: "retry", stop: null };
  }
  if (status === 401 || status === 403) {
    return { outcome: "deferred", stop: "provider_auth" };
  }
  if (status >= 500) return { outcome: "retry", stop: null };
  return { outcome: "failed", stop: null };
}

function providerId(body: string): string | null {
  try {
    const value = JSON.parse(body);
    return typeof value?.id === "string" ? value.id : null;
  } catch {
    return null;
  }
}

async function settle(
  deps: SendDigestDeps,
  row: ClaimedDigest,
  outcome: DigestOutcome,
  error: string | null,
  id: string | null,
  summary: SendDigestSummary,
): Promise<void> {
  try {
    const settled = await deps.settle(
      row.digest_id,
      row.attempt,
      outcome,
      error,
      id,
    );
    if (settled === "sent") summary.sent++;
    else if (settled === "failed") summary.failed++;
    else if (settled === "pending") {
      if (outcome === "deferred") summary.deferred++;
      else summary.retried++;
    }
  } catch (cause) {
    // The row stays leased and is claimed again once its lease runs out;
    // Resend's idempotency key keeps a second attempt from a second email.
    console.error("settle failed", row.digest_id, cause);
  }
}

/** Sends one digest; returns why the run must stop, if it must. */
async function deliver(
  row: ClaimedDigest,
  deps: SendDigestDeps,
  origin: string,
  summary: SendDigestSummary,
): Promise<StopReason | null> {
  const items = Array.isArray(row.items) ? row.items : [];
  if (items.length === 0 || !row.email) {
    await settle(deps, row, "failed", "nothing_to_send", null, summary);
    return null;
  }

  const email = renderDigest({
    name: row.member_name ?? "",
    unreadCount: row.unread_count ?? items.length,
    items,
    origin,
  });

  let response: ProviderResponse;
  try {
    response = await deps.send({
      from: deps.sender(),
      to: row.email,
      subject: email.subject,
      text: email.text,
      html: email.html,
      idempotencyKey: `osubb-digest-${row.digest_id}`,
    });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    await settle(deps, row, "retry", `network: ${reason}`, null, summary);
    return null;
  }

  const { outcome, stop } = classify(response);
  await settle(
    deps,
    row,
    outcome,
    outcome === "sent" ? null : `HTTP ${response.status}: ${response.body}`
      .trim(),
    outcome === "sent" ? providerId(response.body) : null,
    summary,
  );
  return stop;
}

export async function handleSendDigest(
  req: Request,
  deps: SendDigestDeps,
): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return json({ error: "body too large" }, 413);
  }

  const keys = deps.secretKeys();
  if (keys.length === 0) {
    console.error("send-digest configuration", ["SUPABASE_SECRET_KEYS"]);
    return json({ error: "configuration" }, 500);
  }
  // verify_jwt = false in config.toml: this constant-time comparison is the
  // whole authentication, as in send-push (#769, ruling L8).
  if (!isSecretKey(req.headers.get("apikey"), keys)) {
    return json({ error: "secret key only" }, 401);
  }

  const problems = deps.configProblems();
  const origin = deps.appOrigin();
  if (problems.length > 0 || origin === null) {
    // Checked before claiming, so a missing setting burns no attempts.
    console.error("send-digest configuration", problems);
    return json({ error: "configuration", problems }, 500);
  }

  const summary: SendDigestSummary = {
    claimed: 0,
    sent: 0,
    retried: 0,
    deferred: 0,
    failed: 0,
  };
  let stop: StopReason | null = null;
  let first = true;

  try {
    for (let batch = 0; batch < MAX_BATCHES && stop === null; batch++) {
      const rows = await deps.claim(BATCH_SIZE);
      summary.claimed += rows.length;
      for (const row of rows) {
        if (stop !== null) {
          // Claimed but not sent: back to the queue for the next morning,
          // without counting an attempt.
          await settle(deps, row, "deferred", stop, null, summary);
          continue;
        }
        if (!first) await deps.pause(SEND_GAP_MS);
        first = false;
        stop = await deliver(row, deps, origin, summary);
      }
      if (rows.length < BATCH_SIZE) break;
    }
  } catch (cause) {
    console.error("claim failed", cause);
    return json({ error: "claim failed", ...summary }, 500);
  }

  console.log("send-digest", summary, stop ?? "");
  if (stop === "provider_auth") {
    return json({ error: "provider refused the key", ...summary }, 502);
  }
  return json(summary, 200);
}
