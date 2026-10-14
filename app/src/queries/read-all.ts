/** PostgREST answers at most this many rows a request (`max_rows` in
    supabase/config.toml, the same on staging and production), silently. */
export const READ_PAGE = 500;

/**
 * Every row of a read that can pass `READ_PAGE`, asked a page at a time until
 * a short page. `readPage` builds the read afresh for each page and ends its
 * order on a unique column, so no row is skipped or repeated. A failed page
 * fails the whole read: a list is never shown as whole when it is not.
 */
export async function readAllRows<T>(
  readPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += READ_PAGE) {
    const { data, error } = await readPage(from, from + READ_PAGE - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < READ_PAGE) return rows;
  }
}
