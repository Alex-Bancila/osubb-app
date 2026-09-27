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
//        nothing is parsed or written
//   413  a body over 64 KB: refused before the signature is even computed,
//        reading no further than the cap
//   405  not POST
//
// A delivery is acted on once: the database records each svix-id per
// recipient address, so a replayed request -- within the timestamp window,
// or a retry on another day -- writes nothing the second time.
//
//   500  RESEND_WEBHOOK_SECRET or the project's secret key is missing, or the
//        database call failed (Resend retries; the dedupe makes that safe)
//
// Handled: email.bounced (the receiving server rejected the email; Resend's
// bounce.type says whether for good -- Permanent -- or not),
// email.complained (the recipient marked a delivered email as spam),
// email.suppressed (Resend did not send because the address is on its
// suppression list). email.failed, email.delivery_delayed and the rest are
// ignored: none of them says the address itself is bad.

import type { HandledEvent, ResendWebhookDeps } from "./deps.ts";
import { decodeSigningSecret, verifySignature } from "./signature.ts";

/** The largest body read. Resend's email events are a few kilobytes. */
export const MAX_BODY_BYTES = 64 * 1024;

/**
 * The request body as text, or null once it passes `limit` bytes. A
 * declared Content-Length over the limit is refused without reading; the
 * stream is read chunk by chunk and cancelled the moment it passes the limit,
 * so a sender that lies about (or omits) the length still cannot make the
 * function buffer more than the cap.
 */
export async function readBodyCapped(
  req: Request,
  limit: number,
): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

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

  // The raw body, byte for byte: the signature covers it exactly. Capped
  // first, so an unsigned sender cannot make the function hash megabytes.
  const body = await readBodyCapped(req, MAX_BODY_BYTES);
  if (body === null) {
    return json({ error: "body too large" }, 413);
  }
  const deliveryId = req.headers.get("svix-id");
  // verify_jwt = false in config.toml: this check is the whole
  // authentication, and it runs before the body is parsed.
  const problem = await verifySignature(
    {
      id: deliveryId,
      timestamp: req.headers.get("svix-timestamp"),
      signature: req.headers.get("svix-signature"),
      body,
    },
    key,
    deps.nowSeconds(),
  );
  if (problem || !deliveryId) {
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
      notified += await deps.notify(deliveryId, email, type, reason);
    }
  } catch (cause) {
    console.error("resend-webhook notify failed", cause);
    return json({ error: "notify failed" }, 500);
  }

  console.log("resend-webhook", type, { notified });
  return json({ notified }, 200);
}
