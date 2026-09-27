// resend-webhook -- #776, ruling L20.
// Resend calls this for every event the endpoint is subscribed to. A bounce,
// a spam complaint or a suppression becomes one in-app system Notification
// for every live active BC and Moderator (level >= 6), naming the Member and
// linking to their Administrare page, deduped per address per day in the
// database (public.notify_email_delivery_problem).
//
// POST, signed by Resend (svix-id, svix-timestamp, svix-signature)
//   200 { notified }            a handled event: Notifications written (0 for
//                               an unknown address or one already reported
//                               today)
//   200 { notified: 0, ignored } any other event type -- nothing to do, and a
//                               non-2xx would only make Resend retry it
//   400  the signed body is not a Resend event
//   401  missing, stale (more than 5 minutes either way) or wrong signature;
//        nothing is read or written
//   405  not POST
//   500  RESEND_WEBHOOK_SECRET or the project's secret key is missing, or the
//        database call failed (Resend retries; the dedupe makes that safe)
//
// Handled: email.bounced (the receiving server refused the address for good),
// email.complained (the recipient marked a delivered email as spam),
// email.suppressed (Resend did not send because the address is on its
// suppression list). email.failed, email.delivery_delayed and the rest are
// ignored: none of them says the address itself is bad.

import type { HandledEvent, ResendWebhookDeps } from "./deps.ts";
import { decodeSigningSecret, verifySignature } from "./signature.ts";

export const HANDLED_EVENTS: readonly HandledEvent[] = [
  "email.bounced",
  "email.complained",
  "email.suppressed",
];

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isHandled(type: unknown): type is HandledEvent {
  return typeof type === "string" &&
    (HANDLED_EVENTS as readonly string[]).includes(type);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * The recipient addresses of an event's `data.to` (an array in Resend's
 * payloads; a single string is accepted too), bare: `Ana <ana@x.ro>` gives
 * `ana@x.ro`. Anything without an `@` is dropped.
 */
export function recipients(to: unknown): string[] {
  const list = Array.isArray(to) ? to : [to];
  const addresses: string[] = [];
  for (const entry of list) {
    const value = text(entry);
    if (!value) continue;
    const bare = value.match(/<([^<>]+)>\s*$/)?.[1]?.trim() ?? value;
    if (bare.includes("@")) addresses.push(bare);
  }
  return [...new Set(addresses)];
}

/**
 * What Resend says went wrong, for the Notification body: the bounce's
 * type/subType and message, or the suppression's type and message. A
 * complaint carries no reason.
 */
export function reasonOf(
  type: HandledEvent,
  data: Record<string, unknown>,
): string | null {
  const detail = type === "email.bounced"
    ? data.bounce
    : type === "email.suppressed"
    ? data.suppressed
    : null;
  if (typeof detail !== "object" || detail === null) return null;
  const record = detail as Record<string, unknown>;
  const kind = [text(record.type), text(record.subType)]
    .filter((part) => part !== null)
    .join("/");
  const message = text(record.message);
  if (kind && message) return `${kind}: ${message}`;
  return kind || message;
}

export async function handleResendWebhook(
  req: Request,
  deps: ResendWebhookDeps,
): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const problems: string[] = [];
  const key = decodeSigningSecret(deps.signingSecret());
  if (!key) problems.push("RESEND_WEBHOOK_SECRET");
  if (!deps.hasSecretKey()) problems.push("SUPABASE_SECRET_KEYS");
  if (!key || problems.length > 0) {
    // Names only, never values. Without the signing secret nothing could
    // ever be verified; say so rather than answer 401 to Resend.
    console.error("resend-webhook configuration", problems);
    return json({ error: "configuration", problems }, 500);
  }

  // The raw body, byte for byte: the signature covers it exactly.
  const body = await req.text();
  // verify_jwt = false in config.toml: this check is the whole
  // authentication, and it runs before the body is parsed.
  const problem = await verifySignature(
    {
      id: req.headers.get("svix-id"),
      timestamp: req.headers.get("svix-timestamp"),
      signature: req.headers.get("svix-signature"),
      body,
    },
    key,
    deps.nowSeconds(),
  );
  if (problem) {
    console.warn("resend-webhook refused", problem);
    return json({ error: "invalid signature" }, 401);
  }

  let event: unknown;
  try {
    event = JSON.parse(body);
  } catch {
    return json({ error: "not a Resend event" }, 400);
  }
  if (typeof event !== "object" || event === null) {
    return json({ error: "not a Resend event" }, 400);
  }
  const { type, data } = event as { type?: unknown; data?: unknown };
  if (!isHandled(type)) {
    return json({ notified: 0, ignored: String(type ?? "") }, 200);
  }
  if (typeof data !== "object" || data === null) {
    return json({ error: "not a Resend event" }, 400);
  }

  const payload = data as Record<string, unknown>;
  const reason = reasonOf(type, payload);
  let notified = 0;
  try {
    for (const email of recipients(payload.to)) {
      notified += await deps.notify(email, type, reason);
    }
  } catch (cause) {
    console.error("resend-webhook notify failed", cause);
    return json({ error: "notify failed" }, 500);
  }

  console.log("resend-webhook", type, { notified });
  return json({ notified }, 200);
}
