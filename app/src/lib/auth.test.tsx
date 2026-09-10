import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

type Listener = (event: string, session: unknown) => void;
// Shape of a stored Supabase session, as returned by getSession() and built
// by sessionFor() below — named here so getSession's mock can be typed to
// accept either a real stored session or null, not just null.
type StoredSession = { user: { id: string }; access_token: string };
const auth = vi.hoisted(() => {
  let listener: Listener | null = null;
  return {
    listener: () => listener,
    getSession: vi.fn(
      async (): Promise<{ data: { session: StoredSession | null } }> => ({
        data: { session: null },
      }),
    ),
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

function sessionFor(id: string): StoredSession {
  return { user: { id }, access_token: 'x.eyJhcHBfbWV0YWRhdGEiOnt9fQ.y' };
}

function notifyListener() {
  const notify = auth.listener();
  if (!notify) throw new Error('no auth listener registered');
  return notify;
}

// A promise this test controls the resolution of, so it can simulate a
// getSession() call that is still in flight while other auth events fire.
function createDeferred<T>() {
  let resolveDeferred: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve) => {
    resolveDeferred = resolve;
  });
  return {
    promise,
    resolve(value: T) {
      if (!resolveDeferred) throw new Error('deferred never initialized');
      resolveDeferred(value);
    },
  };
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

  it('does not let a slow getSession() resolution stomp a newer signed-in member', async () => {
    // Simulates: member A's stored session is still being read back from
    // storage when member B signs in on the same device. The getSession()
    // promise settles afterwards, with A's session — it must not overwrite
    // lastUserId back to A, or the next real transition away from B would
    // compare against A and silently skip the cache clear.
    const deferred = createDeferred<{
      data: { session: StoredSession | null };
    }>();
    auth.getSession.mockReturnValueOnce(deferred.promise);

    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <div />
        </AuthProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(auth.listener()).not.toBeNull());

    // B signs in while getSession() is still pending.
    notifyListener()('SIGNED_IN', sessionFor('b'));
    client.setQueryData(['profile', 'me', { memberId: 'b' }], {
      full_name: 'B',
    });

    // The stale getSession() call now resolves with A's stored session.
    deferred.resolve({ data: { session: sessionFor('a') } });
    await waitFor(() => expect(auth.getSession).toHaveBeenCalled());

    // A later transition back to A must still be seen as a change away from
    // B (not a no-op against a wrongly-restored 'a'), so it clears B's data.
    notifyListener()('SIGNED_IN', sessionFor('a'));

    await waitFor(() =>
      expect(
        client.getQueryData(['profile', 'me', { memberId: 'b' }]),
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
