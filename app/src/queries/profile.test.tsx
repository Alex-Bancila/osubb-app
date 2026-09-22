import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
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

import { fetchMyProfile, useMyProfile, useUpdateMyProfile } from './profile';
import { keys } from './keys';

const memberId = 'p1000000-0000-0000-0000-000000000001';

function wrapper(queryClient: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe('profile queries and mutations', () => {
  beforeEach(() => {
    resetSupabaseMock();
    vi.restoreAllMocks();
  });

  describe('fetchMyProfile', () => {
    it('fetches profile and contact details through profiles and profiles_contact', async () => {
      supabaseMock.from.mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: memberId,
                    full_name: 'Alex Băncilă',
                    role: 'bc',
                    status: 'activ',
                    avatar_color: '#ED2025',
                    joined_year: 2024,
                    joined_at: '2024-01-01',
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'profiles_contact') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    email: 'alex@osubb.ro',
                    phone: '0712345678',
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        return supabaseMock;
      });

      const profile = await fetchMyProfile(memberId);

      expect(profile).toEqual({
        id: memberId,
        full_name: 'Alex Băncilă',
        role: 'bc',
        status: 'activ',
        avatar_color: '#ED2025',
        joined_year: 2024,
        joined_at: '2024-01-01',
        email: 'alex@osubb.ro',
        phone: '0712345678',
      });
    });

    it('handles null contact info safely', async () => {
      supabaseMock.from.mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: memberId,
                    full_name: 'Recrut Nou',
                    role: 'recrut',
                    status: 'activ',
                    avatar_color: null,
                    joined_year: 2026,
                    joined_at: '2026-09-01',
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'profiles_contact') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null,
                  error: null,
                }),
              }),
            }),
          };
        }
        return supabaseMock;
      });

      const profile = await fetchMyProfile(memberId);

      expect(profile).toEqual({
        id: memberId,
        full_name: 'Recrut Nou',
        role: 'recrut',
        status: 'activ',
        avatar_color: null,
        joined_year: 2026,
        joined_at: '2026-09-01',
        email: null,
        phone: null,
      });
    });
  });

  describe('useMyProfile', () => {
    it('queries with keys.profile.me(id) when session exists', async () => {
      auth.useAuth.mockReturnValue({ session: { user: { id: memberId } } });

      supabaseMock.from.mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: memberId,
                    full_name: 'Ana Popescu',
                    role: 'voluntar',
                    status: 'activ',
                    avatar_color: '#284C93',
                    joined_year: 2025,
                    joined_at: '2025-01-01',
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'profiles_contact') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { email: 'ana@osubb.ro', phone: null },
                  error: null,
                }),
              }),
            }),
          };
        }
        return supabaseMock;
      });

      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });

      const { result } = renderHook(() => useMyProfile(), {
        wrapper: wrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.full_name).toBe('Ana Popescu');
      expect(result.current.data?.email).toBe('ana@osubb.ro');
      expect(result.current.data?.phone).toBeNull();
    });
  });

  describe('useUpdateMyProfile', () => {
    it('submits update to profiles table without selecting revoked phone column and invalidates cache', async () => {
      auth.useAuth.mockReturnValue({ session: { user: { id: memberId } } });

      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      supabaseMock.from.mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            update: updateMock,
          };
        }
        return supabaseMock;
      });

      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useUpdateMyProfile(), {
        wrapper: wrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          fullName: 'Ana Ionescu',
          phone: '0799887766',
          avatarColor: '#007F33',
        });
      });

      expect(updateMock).toHaveBeenCalledWith({
        full_name: 'Ana Ionescu',
        phone: '0799887766',
        avatar_color: '#007F33',
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: keys.profile.all,
      });
    });
  });
});
