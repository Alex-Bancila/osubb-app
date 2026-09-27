// send-push — #703, ADR-0010.
// Delivers the Web Push outbox (public.push_deliveries). Called every minute
// by the pg_cron job osubb-send-push through pg_net, and only when a row is
// due; nothing else should call it.
//
// POST (any body)
//   200 { claimed, sent, retried, dead, failed }
//   401  the apikey header is not one of the project's secret keys
//        (sb_secret_...; the cron job sends it from the Vault row secret_key)
//   405  not POST
//   500  a required secret is missing or malformed, or a claim failed
//
// Every error body is { code, error } (_shared/errors.ts). Which secret is
// missing, and why a claim failed, is in the function log only.
//
// Outcomes per push service answer (ADR-0010):
//   2xx                  -> sent
//   404 / 410            -> dead: the push_tokens row is deleted, its outbox
//                           rows cascade
//   429 / 5xx / network  -> retry after 1, 2, 4, 8 minutes, then failed
//   any other status     -> failed at once (400/401/403 is a VAPID or payload
//                           fault), with the response body (its first 1 KB)
//                           as last_error
//
// An endpoint off the browser vendors' push services is never fetched
// (security pass M2): it fails as endpoint_not_allowed. push_tokens_guard
// refuses such a registration since 20260927170000; this covers any row
// stored before it.

import { errorBody } from "../_shared/errors.ts";
import { isSecretKey } from "../_shared/secret-keys.ts";
import { InvalidSubscriptionError } from "./deps.ts";
import { buildPushPayload } from "./payload.ts";
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

/** The answer to a missing or malformed setting; the log names which. */
const CONFIGURATION_ERROR = errorBody(
  "configuration",
  "The function is not configured. See its logs.",
);

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function classify(status: number): Outcome {
  if (status >= 200 && status < 300) return "sent";
  if (status === 404 || status === 410) return "dead";
  if (status === 429 || status >= 500) return "retry";
  return "failed";
}

/**
 * The browser vendors' push services, as push_tokens_guard lists them
 * (migration 20260927170000_push_token_limits.sql): FCM for Chrome and the
 * Chromium browsers, Mozilla autopush, Apple, and WNS for Edge on Windows.
 */
const PUSH_SERVICE_HOSTS: readonly RegExp[] = [
  /^fcm\.googleapis\.com$/,
  /^[a-z0-9-]+(\.[a-z0-9-]+)*\.push\.services\.mozilla\.com$/,
  /^[a-z0-9-]+(\.[a-z0-9-]+)*\.push\.apple\.com$/,
  /^[a-z0-9-]+(\.[a-z0-9-]+)*\.notify\.windows\.com$/,
];

/**
 * Whether send-push may POST to this endpoint: https on the default port, no
 * user info, and a host on {@link PUSH_SERVICE_HOSTS}. Anything else would
 * let a Member aim Supabase's egress at a host of their choosing.
 */
export function isPushServiceEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  return url.protocol === "https:" && url.port === "" &&
    url.username === "" && url.password === "" &&
    PUSH_SERVICE_HOSTS.some((host) => host.test(url.hostname));
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
  origin: string | null,
  summary: SendPushSummary,
): Promise<void> {
  let outcome: Outcome = "failed";
  let error: string | null = null;

  const subscription = parseSubscription(row.token);
  if (!subscription) {
    // Never delete a Member's device over a shape this function cannot read.
    error = "invalid_subscription";
  } else if (!isPushServiceEndpoint(subscription.endpoint)) {
    // Never fetched: the host is not a push service (security pass M2).
    error = "endpoint_not_allowed";
  } else {
    // The Notification's own row and nothing else (ADR-0010), in the service
    // worker's shape and, given an https app origin, the declarative one too
    // (#778); the body is cut so it stays one push message.
    const payload = buildPushPayload(row, origin);
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
  if (req.method !== "POST") {
    return json(errorBody("method_not_allowed", "Use POST."), 405);
  }

  const keys = deps.secretKeys();
  if (keys.length === 0) {
    // Without a key to compare with, nobody could ever be let in; say so
    // rather than answer 401 to the right caller. The setting's name goes to
    // the function log only: this answer reaches anyone, unauthenticated
    // (security pass L4).
    console.error("send-push configuration", ["SUPABASE_SECRET_KEYS"]);
    return json(CONFIGURATION_ERROR, 500);
  }
  // verify_jwt = false in config.toml, so the gateway checks nothing and this
  // constant-time comparison is the whole authentication (#769, ruling L8).
  if (!isSecretKey(req.headers.get("apikey"), keys)) {
    return json(
      errorBody("secret_key_required", "Secret key only."),
      401,
    );
  }

  const problems = deps.configProblems();
  if (problems.length > 0) {
    // Checked before claiming, so a missing or malformed secret burns no
    // attempts. The names go to the function log, never into the answer.
    console.error("send-push configuration", problems);
    return json(CONFIGURATION_ERROR, 500);
  }

  const summary: SendPushSummary = {
    claimed: 0,
    sent: 0,
    retried: 0,
    dead: 0,
    failed: 0,
  };

  const origin = deps.appOrigin();

  try {
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const rows = await deps.claim(BATCH_SIZE);
      summary.claimed += rows.length;
      await Promise.all(
        rows.map((row) => deliver(row, deps, origin, summary)),
      );
      if (rows.length < BATCH_SIZE) break;
    }
  } catch (cause) {
    console.error("claim failed", summary, cause);
    return json(errorBody("claim_failed", "Claiming deliveries failed."), 500);
  }

  console.log("send-push", summary);
  return json(summary, 200);
}
