// Resend signs every webhook request the Svix way (Resend's docs point at
// Svix's "verifying payloads manually"): three headers, and an HMAC-SHA256
// over `${svix-id}.${svix-timestamp}.${raw body}` keyed with the base64 part
// of the endpoint's signing secret (`whsec_<base64>`). The `svix-signature`
// header holds one or more space-separated `v1,<base64 signature>` entries;
// one match is enough. No library: Deno's Web Crypto does the HMAC, and the
// comparison is _shared/secret-keys.ts's constant-time one.

import { constantTimeEqual } from "../_shared/secret-keys.ts";

/** How far `svix-timestamp` may be from now, either way (Svix's default). */
export const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

export interface SignedRequest {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  body: string;
}

/** Why a request was refused; never echoed to the caller, only logged. */
export type SignatureProblem =
  | "missing_headers"
  | "invalid_timestamp"
  | "stale_timestamp"
  | "no_matching_signature";

const encoder = new TextEncoder();

/**
 * The HMAC key bytes of a `whsec_` signing secret, or null when the value is
 * not one: no prefix, or a remainder that is not base64.
 */
export function decodeSigningSecret(secret: string): Uint8Array | null {
  const trimmed = secret.trim();
  if (!trimmed.startsWith("whsec_")) return null;
  const encoded = trimmed.slice("whsec_".length);
  if (encoded === "") return null;
  try {
    return Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function toBase64(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The `v1,` signature Resend would send for this id, timestamp and body. */
export async function sign(
  key: Uint8Array,
  id: string,
  timestamp: string,
  body: string,
): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(`${id}.${timestamp}.${body}`),
  );
  return toBase64(mac);
}

/**
 * Null when the request carries a valid signature from this secret with a
 * timestamp within the tolerance of `nowSeconds`; otherwise what is wrong.
 * Every listed signature is compared, even after a match.
 */
export async function verifySignature(
  request: SignedRequest,
  key: Uint8Array,
  nowSeconds: number,
): Promise<SignatureProblem | null> {
  const { id, timestamp, signature, body } = request;
  if (!id || !timestamp || !signature) return "missing_headers";
  if (!/^\d{1,12}$/.test(timestamp)) return "invalid_timestamp";
  if (Math.abs(nowSeconds - Number(timestamp)) > TIMESTAMP_TOLERANCE_SECONDS) {
    return "stale_timestamp";
  }

  const expected = await sign(key, id, timestamp, body);
  let matched = false;
  for (const entry of signature.split(" ")) {
    const [version, value] = entry.split(",", 2);
    if (version !== "v1" || !value) continue;
    if (constantTimeEqual(value, expected)) matched = true;
  }
  return matched ? null : "no_matching_signature";
}
