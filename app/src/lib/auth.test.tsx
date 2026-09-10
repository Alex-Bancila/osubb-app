import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

import { AuthProvider, useAuth } from './auth';

function sessionFor(id: string) {
  return { user: { id }, access_token: 'x.eyJhcHBfbWV0YWRhdGEiOnt9fQ.y' };
}

function notifyListener() {
  const notify = auth.listener();
  if (!notify) throw new Error('no auth listener registered');
  return notify;
}

// Renders inside AuthProvider so a test can trigger the explicit signOut()
// path directly, independent of the onAuthStateChange listener.
function SignOutButton() {
  const { signOut } = useAuth();
  return <button onClick={() => void signOut()}>Sign out</button>;
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

  it('clears the query cache when signOut() is called, independent of the listener', async () => {
    // The mocked supabase.auth.signOut above never invokes the registered
    // listener, unlike the real client (which emits SIGNED_OUT through
    // onAuthStateChange too). That is what isolates this test to the
    // explicit signOut() path in AuthProvider's memoised value, rather than
    // the listener path already covered above.
    const client = new QueryClient();
    client.setQueryData(['profile', 'me', { memberId: 'a' }], {
      full_name: 'A',
    });
    render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <SignOutButton />
        </AuthProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(auth.listener()).not.toBeNull());

    fireEvent.click(screen.getByText('Sign out'));

    await waitFor(() => expect(auth.signOut).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        client.getQueryData(['profile', 'me', { memberId: 'a' }]),
      ).toBeUndefined(),
    );
  });
});
