import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
}));
const auth = vi.hoisted(() => ({ useAuth: vi.fn() }));

vi.mock('../lib/supabase', () => ({
  supabase: { from: api.from },
}));
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
    vi.clearAllMocks();
    api.from.mockReturnValue({ select: api.select });
    api.select.mockReturnValue({ eq: api.eq, maybeSingle: api.maybeSingle });
    api.eq.mockReturnValue({ maybeSingle: api.maybeSingle });
  });

  it('reads the self-scoped endpoint without sending a member id', async () => {
    api.maybeSingle.mockResolvedValue({ data: { points: 4 }, error: null });
    auth.useAuth.mockReturnValue({ session: { user: { id: memberId } } });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => useMyPoints(), {
      wrapper: wrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(4);
    expect(api.from).toHaveBeenCalledWith('my_points');
    expect(api.select).toHaveBeenCalledWith('points');
    expect(api.eq).not.toHaveBeenCalled();
    expect(api.maybeSingle).toHaveBeenCalledOnce();
  });

  it('isolates cached totals by authenticated member', () => {
    const anotherMember = 'a5100000-0000-0000-0000-000000000002';

    expect(keys.points.me(memberId)).toEqual(['points', 'me', { memberId }]);
    expect(keys.points.me(memberId)).not.toEqual(keys.points.me(anotherMember));
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
    expect(api.from).not.toHaveBeenCalled();
  });
});
