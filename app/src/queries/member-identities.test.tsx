import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const directory = vi.hoisted(() => ({
  read: vi.fn(),
}));
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ in: directory.read }),
    }),
  },
}));
vi.mock('../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'viewer' } } }),
}));

import { useMemberIdentitiesByPage } from './member-identities';

/** The directory answers for every id it is asked. */
function answerEveryone() {
  directory.read.mockImplementation((_column: string, ids: string[]) =>
    Promise.resolve({
      data: ids.map((id) => ({
        id,
        full_name: `Membru ${id}`,
        nickname: null,
        avatar_color: null,
      })),
      error: null,
    }),
  );
}

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useMemberIdentitiesByPage (R56)', () => {
  beforeEach(() => {
    directory.read.mockReset();
  });

  // Fails if one read covers every page: a page that lands then asks for
  // every Member again, and the names already drawn fall back to
  // "Membru OSUBB" until it answers.
  it('reads each page’s Members once, and keeps the names already read while a new page’s are read', async () => {
    answerEveryone();
    const { result, rerender } = renderHook(
      ({ pages }: { pages: string[][] }) => useMemberIdentitiesByPage(pages),
      { wrapper: wrapper(), initialProps: { pages: [['b', 'a', 'a']] } },
    );
    await waitFor(() =>
      expect(result.current.get('a')?.fullName).toBe('Membru a'),
    );
    expect(result.current.get('b')?.fullName).toBe('Membru b');

    let answer!: () => void;
    directory.read.mockImplementationOnce(
      (_column: string, ids: string[]) =>
        new Promise((resolve) => {
          answer = () =>
            resolve({
              data: ids.map((id) => ({
                id,
                full_name: `Membru ${id}`,
                nickname: null,
                avatar_color: null,
              })),
              error: null,
            });
        }),
    );
    rerender({ pages: [['b', 'a', 'a'], ['c']] });
    // The second page's read is on its way; the first page's names stay.
    expect(result.current.get('a')?.fullName).toBe('Membru a');
    expect(result.current.has('c')).toBe(false);
    answer();
    await waitFor(() =>
      expect(result.current.get('c')?.fullName).toBe('Membru c'),
    );
    expect(directory.read.mock.calls.map(([, ids]) => ids)).toEqual([
      ['a', 'b'],
      ['c'],
    ]);
  });

  it('asks nothing for a page without Members', () => {
    const { result } = renderHook(() => useMemberIdentitiesByPage([[]]), {
      wrapper: wrapper(),
    });
    expect(directory.read).not.toHaveBeenCalled();
    expect(result.current.size).toBe(0);
  });
});
