/**
 * Strict readers for ids that arrive as text — route params (`/grupuri/:id`)
 * and query keys (`?task=`, `?membru=`, the Work Filter). `Number()` would
 * accept `1e3`, `0x10`, `1.5` and turn anything else into `NaN`; these accept
 * exactly the shape the database hands out and nothing else, so a screen can
 * show its not-found state instead of sending a malformed value to a query.
 */

/** A positive whole number written as plain digits, or `null`. */
export function parsePositiveInt(
  raw: string | null | undefined,
): number | null {
  if (!raw || !/^[1-9][0-9]*$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A Member id (`profiles.id`, a UUID). */
export function isUuid(raw: string | null | undefined): raw is string {
  return typeof raw === 'string' && UUID.test(raw);
}
