/** PostgREST may throw plain objects; never expose their internal messages. */
export function queryErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return;
  return typeof error.code === 'string' ? error.code : undefined;
}
export function queryErrorMessage(
  error: unknown,
  fallback = 'Nu am putut încărca datele.',
): string {
  return queryErrorCode(error) === '42501'
    ? 'Nu ai permisiunea să accesezi aceste date.'
    : fallback;
}
