/**
 * What a value becomes before any rule looks at it (ruling R8, R6): the ends
 * of every text are trimmed, an email is lowercased, a phone number is E.164.
 * The server applies the same rules (#673), so what the browser measures is
 * what the database stores.
 */

/** The text without its leading and trailing whitespace; nothing becomes ''. */
export function trimText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

/** An empty value is no value: `''` (or nothing) becomes `null`. */
export function emptyToNull(value: string | null | undefined): string | null {
  return value === undefined || value === null || value === '' ? null : value;
}

/** An address is compared lowercased and without surrounding spaces. */
export function normalizeEmail(value: string | null | undefined): string {
  return trimText(value).toLowerCase();
}

/**
 * Length as Postgres `char_length` counts it: in characters (code points), not
 * UTF-16 units, so an emoji counts once in the browser and in the database.
 */
export function charLength(value: string): number {
  return Array.from(value).length;
}

/**
 * A phone number in E.164, or `null` when it cannot be read. Character for
 * character the rules of `private.normalize_phone` (#673, ruling R8):
 *
 * 1. strip spaces, dots, dashes and parentheses;
 * 2. a leading `00` becomes `+`; no `+` at all means Romania, `+40`;
 * 3. after `+40` or `+373` one trunk `0` is dropped;
 * 4. Romania is `+40` then 9 digits starting with 7, Moldova is `+373` then 8
 *    digits, and any other `+<country>` passes on E.164 length alone (8 to 15
 *    digits, a country code never starting with 0).
 *
 * `+40 0730655145`, `0730655145` and `+40730655145` all give `+40730655145`;
 * `+373 069123456` gives `+37369123456`.
 */
export function normalizePhone(
  value: string | null | undefined,
): string | null {
  let phone = (value ?? '').replace(/[\s.()-]/g, '');
  if (phone === '') return null;
  if (phone.startsWith('00')) phone = `+${phone.slice(2)}`;
  else if (!phone.startsWith('+')) phone = `+40${phone}`;
  if (!/^\+[0-9]+$/.test(phone)) return null;
  if (phone.startsWith('+40')) {
    const digits = phone.slice(3).replace(/^0/, '');
    return /^7[0-9]{8}$/.test(digits) ? `+40${digits}` : null;
  }
  if (phone.startsWith('+373')) {
    const digits = phone.slice(4).replace(/^0/, '');
    return /^[0-9]{8}$/.test(digits) ? `+373${digits}` : null;
  }
  return /^\+[1-9][0-9]{7,14}$/.test(phone) ? phone : null;
}
