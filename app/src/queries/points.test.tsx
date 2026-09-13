import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSupabaseMock, supabaseMock } from '../test/supabase-mock';

const auth = vi.hoisted(() => ({ useAuth: vi.fn() }));

vi.mock('../lib/supabase', async () => {
  const { supabaseClientMock } = await vi.importActual<
    typeof import('../test/supabase-mock')
  >('../test/supabase-mock');
  return { supabase: supabaseClientMock };
});
vi.mock('../lib/auth', () => ({ useAuth: auth.useAuth }));

import { keys } from './keys';
import { useMyPoints } from './points';

const memberId = 'a5100000-0000-0000-0000-000000000001';

function wrapper(queryClient: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe('current-member points query', () => {
  beforeEach(() => {
    resetSupabaseMock();
  });

  it('reads the self-scoped endpoint without sending a member id', async () => {
    supabaseMock.maybeSingle.mockResolvedValue({
      data: { points: 4 },
      error: null,
    });
    auth.useAuth.mockReturnValue({ session: { user: { id: memberId } } });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => useMyPoints(), {
      wrapper: wrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(4);
    expect(supabaseMock.from).toHaveBeenCalledWith('my_points');
    expect(supabaseMock.select).toHaveBeenCalledWith('points');
    expect(supabaseMock.eq).not.toHaveBeenCalled();
    expect(supabaseMock.maybeSingle).toHaveBeenCalledOnce();
  });

  it('isolates cached totals by authenticated member', () => {
    const anotherMember = 'a5100000-0000-0000-0000-000000000002';

    expect(keys.points.me(memberId)).toEqual(['points', 'me', { memberId }]);
    expect(keys.points.me(memberId)).not.toEqual(keys.points.me(anotherMember));
  });

  it('scopes standing by member', () => {
    expect(keys.points.standing('m1')).toEqual([
      'points',
      'standing',
      { memberId: 'm1' },
    ]);
    expect(keys.profile.me('m1')).toEqual([
      'profile',
      'me',
      { memberId: 'm1' },
    ]);
    expect(keys.tasks.mine('m1')).toEqual([
      'tasks',
      'mine',
      { memberId: 'm1' },
    ]);
  });

  it('does not query without an authenticated session', () => {
    auth.useAuth.mockReturnValue({ session: null });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => useMyPoints(), {
      wrapper: wrapper(queryClient),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });
});
