import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

type Listener = (event: string, session: unknown) => void;
const auth = vi.hoisted(() => {
  let listener: Listener | null = null;
  return {
    listener: () => listener,
    getSession: vi.fn(async () => ({ data: { session: null } })),
    onAuthStateChange: vi.fn((cb: Listener) => {
      listener = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
    signOut: vi.fn(async () => ({ error: null })),
  };
});
vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      getSession: auth.getSession,
      onAuthStateChange: auth.onAuthStateChange,
      signOut: auth.signOut,
    },
  },
}));

import { AuthProvider } from './auth';

function sessionFor(id: string) {
  return { user: { id }, access_token: 'x.eyJhcHBfbWV0YWRhdGEiOnt9fQ.y' };
}

function notifyListener() {
  const notify = auth.listener();
  if (!notify) throw new Error('no auth listener registered');
  return notify;
}

describe('AuthProvider cache hygiene', () => {
  it('clears the query cache on SIGNED_OUT', async () => {
    const client = new QueryClient();
    client.setQueryData(['tasks', 'mine', { memberId: 'a' }], [{ id: 1 }]);
    render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <div />
        </AuthProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(auth.listener()).not.toBeNull());

    notifyListener()('SIGNED_IN', sessionFor('a'));
    notifyListener()('SIGNED_OUT', null);

    await waitFor(() =>
      expect(client.getQueryCache().getAll()).toHaveLength(0),
    );
  });

  it('clears the query cache when a different member signs in', async () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <div />
        </AuthProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(auth.listener()).not.toBeNull());

    notifyListener()('SIGNED_IN', sessionFor('a'));
    client.setQueryData(['profile', 'me', { memberId: 'a' }], {
      full_name: 'A',
    });
    notifyListener()('SIGNED_IN', sessionFor('b'));

    await waitFor(() =>
      expect(
        client.getQueryData(['profile', 'me', { memberId: 'a' }]),
      ).toBeUndefined(),
    );
  });
});
