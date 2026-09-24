// send-push — #703, ADR-0010.
// Delivers the Web Push outbox (public.push_deliveries). Called every minute
// by the pg_cron job osubb-send-push through pg_net, and only when a row is
// due; nothing else should call it.
//
// POST (any body)
//   200 { claimed, sent, retried, dead, failed }
//   401  the bearer is not the service-role key
//   405  not POST
//   500  a required secret is missing or malformed, or a claim failed
//
// Outcomes per push service answer (ADR-0010):
//   2xx                  -> sent
//   404 / 410            -> dead: the push_tokens row is deleted, its outbox
//                           rows cascade
//   429 / 5xx / network  -> retry after 1, 2, 4, 8 minutes, then failed
//   any other status     -> failed at once (400/401/403 is a VAPID or payload
//                           fault), with the response body as last_error

import { InvalidSubscriptionError } from "./deps.ts";
import type {
  ClaimedDelivery,
  Outcome,
  PushResponse,
  PushSubscriptionJson,
  SendPushDeps,
} from "./deps.ts";

export const BATCH_SIZE = 100;
// A burst larger than this waits for the next minute's run; the claim leases
// rows for five minutes, far longer than this many batches take.
export const MAX_BATCHES = 10;

export interface SendPushSummary {
  claimed: number;
  sent: number;
  retried: number;
  dead: number;
  failed: number;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * The `role` claim of the bearer JWT, or null. verify_jwt = true in
 * config.toml means the gateway has already checked the signature, so the
 * payload is trusted here; the gateway lets an anon key through, which is
 * why the role still has to be read.
 */
export function bearerRole(header: string | null): string | null {
  const match = /^Bearer ([^.\s]+)\.([^.\s]+)\.([^.\s]+)$/.exec(header ?? "");
  if (!match) return null;
  try {
    const base64 = match[2].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const claims = JSON.parse(atob(padded));
    return typeof claims?.role === "string" ? claims.role : null;
  } catch {
    return null;
  }
}

export function classify(status: number): Outcome {
  if (status >= 200 && status < 300) return "sent";
  if (status === 404 || status === 410) return "dead";
  if (status === 429 || status >= 500) return "retry";
  return "failed";
}

function parseSubscription(token: string): PushSubscriptionJson | null {
  try {
    const value = JSON.parse(token);
    if (
      typeof value?.endpoint === "string" &&
      value.endpoint.startsWith("https://") &&
      typeof value?.keys?.p256dh === "string" &&
      typeof value?.keys?.auth === "string"
    ) {
      return {
        endpoint: value.endpoint,
        keys: { p256dh: value.keys.p256dh, auth: value.keys.auth },
      };
    }
  } catch {
    // fall through
  }
  return null;
}

async function deliver(
  row: ClaimedDelivery,
  deps: SendPushDeps,
  summary: SendPushSummary,
): Promise<void> {
  let outcome: Outcome = "failed";
  let error: string | null = null;

  const subscription = parseSubscription(row.token);
  if (!subscription) {
    // Never delete a Member's device over a shape this function cannot read.
    error = "invalid_subscription";
  } else {
    // The payload is the Notification's own row and nothing else (ADR-0010).
    const payload = JSON.stringify({
      id: row.notification_id,
      title: row.title,
      body: row.body,
      link: row.link,
    });
    let response: PushResponse | null = null;
    try {
      response = await deps.send(subscription, payload);
    } catch (cause) {
      // A subscription the library cannot encrypt for will never work;
      // anything else thrown is the network and is worth retrying.
      const invalid = cause instanceof InvalidSubscriptionError;
      outcome = invalid ? "failed" : "retry";
      const reason = cause instanceof Error ? cause.message : String(cause);
      error = `${invalid ? "invalid_subscription" : "network"}: ${reason}`;
    }
    if (response) {
      outcome = classify(response.status);
      if (outcome !== "sent") {
        error = `HTTP ${response.status}: ${response.body}`.trim();
      }
    }
  }

  try {
    const settled = await deps.settle(
      row.delivery_id,
      row.attempt,
      outcome,
      error,
    );
    if (settled === "sent") summary.sent++;
    else if (settled === "pending") summary.retried++;
    else if (settled === "dead") summary.dead++;
    else if (settled === "failed") summary.failed++;
  } catch (cause) {
    // The row stays leased and is claimed again once its lease runs out.
    console.error("settle failed", row.delivery_id, cause);
  }
}

export async function handleSendPush(
  req: Request,
  deps: SendPushDeps,
): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  if (bearerRole(req.headers.get("Authorization")) !== "service_role") {
    return json({ error: "service_role only" }, 401);
  }

  const problems = deps.configProblems();
  if (problems.length > 0) {
    // Checked before claiming, so a missing or malformed secret burns no
    // attempts.
    console.error("send-push configuration", problems);
    return json({ error: "configuration", problems }, 500);
  }

  const summary: SendPushSummary = {
    claimed: 0,
    sent: 0,
    retried: 0,
    dead: 0,
    failed: 0,
  };

  try {
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const rows = await deps.claim(BATCH_SIZE);
      summary.claimed += rows.length;
      await Promise.all(rows.map((row) => deliver(row, deps, summary)));
      if (rows.length < BATCH_SIZE) break;
    }
  } catch (cause) {
    console.error("claim failed", cause);
    return json({ error: "claim failed", ...summary }, 500);
  }

  console.log("send-push", summary);
  return json(summary, 200);
}
