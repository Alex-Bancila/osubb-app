// The project's secret keys (`sb_secret_...`), shared by every function that
// needs a privileged client or has to authenticate a privileged caller.
//
// Supabase retires the legacy JWT `service_role` key by the end of 2026
// (ruling L8), so no function reads it any more:
// send-push authenticates its caller against these keys (#769), and
// invite-member and csv-import build their admin client from one (#796).

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

/** Thrown at start-up by a function that cannot work without a secret key. */
export class MissingSecretKeyError extends Error {
  constructor(functionName: string) {
    super(
      `${functionName} cannot start: SUPABASE_SECRET_KEYS holds no secret key. ` +
        "Create one in the dashboard under Project Settings → API Keys " +
        "(Secret keys); the platform then provides it to every function. " +
        "The legacy service_role key is not read (#796).",
    );
    this.name = "MissingSecretKeyError";
  }
}

/**
 * The key a privileged client is built from: the `default` secret key, or
 * the first one when there is no `default`. Throws MissingSecretKeyError when
 * there is none, so the function fails at boot with a message that names the
 * fix instead of failing every request with an opaque Auth error.
 */
export function requireSecretKey(
  raw: string | undefined,
  functionName: string,
): string {
  const [key] = parseSecretKeys(raw);
  if (key === undefined) throw new MissingSecretKeyError(functionName);
  return key;
}

const encoder = new TextEncoder();

/**
 * Whether two strings are equal, in time that depends only on their lengths:
 * every byte is compared, with no early exit at the first difference, so the
 * answer time does not reveal how much of a guess was right.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

/**
 * Whether a header is exactly one of the project's secret keys (#769, ruling
 * L8). Every key is compared, even after a match.
 */
export function isSecretKey(header: string | null, keys: string[]): boolean {
  if (!header) return false;
  let matched = false;
  for (const key of keys) {
    if (key !== "" && constantTimeEqual(header, key)) matched = true;
  }
  return matched;
}
