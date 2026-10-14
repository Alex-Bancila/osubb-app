import { describe, expect, it, vi } from 'vitest';
import { READ_PAGE, readAllRows } from './read-all';

/** A table of `count` rows, answered a slice at a time like PostgREST. */
function table(count: number) {
  const rows = Array.from({ length: count }, (_, id) => ({ id }));
  const read = vi.fn(async (from: number, to: number) => ({
    data: rows.slice(from, to + 1),
    error: null,
  }));
  return { rows, read };
}

describe('readAllRows', () => {
  it('reads 500 rows a request, the most PostgREST answers', () => {
    expect(READ_PAGE).toBe(500);
  });

  it('asks page after page until a short one, and keeps every row in order', async () => {
    const { rows, read } = table(1_201);
    await expect(readAllRows(read)).resolves.toEqual(rows);
    expect(read.mock.calls).toEqual([
      [0, 499],
      [500, 999],
      [1_000, 1_499],
    ]);
  });

  it('asks once when the first page is short', async () => {
    const { rows, read } = table(3);
    await expect(readAllRows(read)).resolves.toEqual(rows);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('asks once more after a full last page, and stops on the empty one', async () => {
    const { rows, read } = table(500);
    await expect(readAllRows(read)).resolves.toEqual(rows);
    expect(read.mock.calls).toEqual([
      [0, 499],
      [500, 999],
    ]);
  });

  it('fails whole when a later page fails, and asks for nothing after it', async () => {
    const failure = new Error('offline');
    const read = vi
      .fn()
      .mockResolvedValueOnce({ data: table(500).rows, error: null })
      .mockResolvedValueOnce({ data: null, error: failure });
    await expect(readAllRows(read)).rejects.toBe(failure);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('takes a page without data for an empty one', async () => {
    const read = vi.fn().mockResolvedValue({ data: null, error: null });
    await expect(readAllRows(read)).resolves.toEqual([]);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
