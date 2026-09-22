import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  single: vi.fn(),
  useAuth: vi.fn(),
}));
vi.mock('./supabase', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('./auth', () => ({ useAuth: mocks.useAuth }));

import {
  fetchCapabilities,
  useCapabilities,
  useCapability,
  type Capabilities,
} from './capabilities';
import { keys } from '../queries/keys';

const serverRow = {
  manages_any_group: true,
  manage_tasks: true,
  see_directory: false,
  see_leadership: false,
  manage_roles: false,
  provision_members: false,
  create_top_level_groups: false,
  administer: true,
};

const expected: Capabilities = {
  managesAnyGroup: true,
  manageTasks: true,
  seeDirectory: false,
  seeLeadership: false,
  manageRoles: false,
  provisionMembers: false,
  createTopLevelGroups: false,
  administer: true,
};

function wrapper(queryClient: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockReturnValue({ single: mocks.single });
  mocks.single.mockResolvedValue({ data: serverRow, error: null });
  mocks.useAuth.mockReturnValue({ session: { user: { id: 'member' } } });
});

describe('fetchCapabilities', () => {
  it('reads the one my_capabilities() row and keeps the capability names', async () => {
    await expect(fetchCapabilities()).resolves.toEqual(expected);
    expect(mocks.rpc).toHaveBeenCalledWith('my_capabilities');
    expect(mocks.single).toHaveBeenCalledTimes(1);
  });

  it('propagates a failed read instead of guessing', async () => {
    const error = new Error('denied');
    mocks.single.mockResolvedValue({ data: null, error });
    await expect(fetchCapabilities()).rejects.toBe(error);
  });

  it('carries none of the retired level-map names', async () => {
    const capabilities = await fetchCapabilities();
    for (const retired of [
      'seeAllEvents',
      'createTeams',
      'seeInterne',
      'seeAllSheets',
    ])
      expect(capabilities).not.toHaveProperty(retired);
  });
});

describe('useCapabilities', () => {
  it('asks the server once per session and keeps the row fresh until focus returns', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const first = renderHook(() => useCapabilities(), {
      wrapper: wrapper(queryClient),
    });
    await waitFor(() => expect(first.result.current.data).toEqual(expected));
    const second = renderHook(() => useCapability('manageTasks'), {
      wrapper: wrapper(queryClient),
    });
    await waitFor(() => expect(second.result.current.data).toBe(true));
    expect(mocks.rpc).toHaveBeenCalledTimes(1);

    const query = queryClient
      .getQueryCache()
      .find({ queryKey: keys.capabilities('member') });
    expect(query?.options).toMatchObject({
      staleTime: Infinity,
      refetchOnWindowFocus: 'always',
    });
  });

  it('asks nothing without a session', () => {
    mocks.useAuth.mockReturnValue({ session: null });
    const queryClient = new QueryClient();
    const view = renderHook(() => useCapabilities(), {
      wrapper: wrapper(queryClient),
    });
    expect(view.result.current.data).toBeUndefined();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
