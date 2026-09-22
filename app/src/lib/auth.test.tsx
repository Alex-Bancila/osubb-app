import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (event: string, session: unknown) => void;
// Shape of a stored Supabase session, as returned by getSession() and built
// by sessionFor() below — named here so getSession's mock can be typed to
// accept either a real stored session or null, not just null.
type StoredSession = {
  user: { id: string };
  access_token: string;
  expires_in?: number;
  expires_at?: number;
};
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
    signOut: vi.fn(async (): Promise<{ error: Error | null }> => ({
      error: null,
    })),
    refreshSession: vi.fn(
      async (): Promise<{ data: { session: null }; error: Error | null }> => ({
        data: { session: null },
        error: null,
      }),
    ),
  };
});
vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      getSession: auth.getSession,
      onAuthStateChange: auth.onAuthStateChange,
      signOut: auth.signOut,
      refreshSession: auth.refreshSession,
    },
  },
}));

import { AuthProvider, useAuth } from './auth';

// Builds a stored session. Passing `issuedAtMs` also stamps `expires_at` /
// `expires_in` the way the real client does (a fixed one-hour lifetime), so
// the focus-refresh tests below can control how stale the token looks
// without existing tests — which never fire a focus/visibility event —
// having to care.
function sessionFor(
  id: string,
  options?: { issuedAtMs?: number },
): StoredSession {
  const base: StoredSession = {
    user: { id },
    access_token: 'x.eyJhcHBfbWV0YWRhdGEiOnt9fQ.y',
  };
  if (options?.issuedAtMs == null) return base;
  return {
    ...base,
    expires_in: 3600,
    expires_at: Math.floor(options.issuedAtMs / 1000) + 3600,
  };
}

// Renders the session's member id so a test can wait for a notified session
// to have actually committed (including the ref the focus-refresh effect
// reads) before firing a focus/visibility event at it.
function SessionProbe() {
  const { session } = useAuth();
  return <div data-testid="session-user">{session?.user.id ?? ''}</div>;
}

// Builds a fake access token whose payload segment decodes to the given
// app_metadata, base64url-encoded the same way a real JWT is (no padding).
function tokenWithAppMetadata(appMetadata: unknown): string {
  const json = JSON.stringify({ app_metadata: appMetadata });
  const base64url = btoa(json)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `x.${base64url}.y`;
}

// Renders the decoded claims so a test can assert on them without exporting
// decodeClaims() itself -- useAuth() is the one sanctioned way to read them.
function ClaimsProbe() {
  const { claims } = useAuth();
  return (
    <div data-testid="group-ids">
      {JSON.stringify(claims?.group_ids ?? null)}
    </div>
  );
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

  it('preserves member state when sign-out fails', async () => {
    auth.signOut.mockResolvedValueOnce({
      error: new Error('provider details that must stay private'),
    });
    const client = new QueryClient();
    client.setQueryData(['profile', 'me', { memberId: 'a' }], {
      full_name: 'A',
    });

    function FailedSignOut() {
      const { signOut } = useAuth();
      return (
        <button onClick={() => void signOut().catch(() => undefined)}>
          Sign out
        </button>
      );
    }

    render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <FailedSignOut />
        </AuthProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(auth.listener()).not.toBeNull());

    fireEvent.click(screen.getByText('Sign out'));

    await waitFor(() => expect(auth.signOut).toHaveBeenCalled());
    expect(client.getQueryData(['profile', 'me', { memberId: 'a' }])).toEqual({
      full_name: 'A',
    });
  });
});

describe('decodeClaims', () => {
  it('decodes group_ids from the access token (#510, ADR-0009 Wave 1)', async () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <ClaimsProbe />
        </AuthProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(auth.listener()).not.toBeNull());

    notifyListener()('SIGNED_IN', {
      user: { id: 'g' },
      access_token: tokenWithAppMetadata({
        member_role: 'bc',
        member_level: 6,
        dept_ids: [],
        team_ids: [],
        group_ids: [3, 9],
      }),
    });

    await waitFor(() =>
      expect(screen.getByTestId('group-ids').textContent).toBe('[3,9]'),
    );
  });
});

describe('refresh a stale session on window focus (#598)', () => {
  beforeEach(() => {
    // Only Date is faked: setTimeout stays real, so Testing Library's
    // waitFor() keeps polling normally while the test still controls what
    // `Date.now()` reports for the token-age check.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-22T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function renderSignedIn(issuedAtMs: number) {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <SessionProbe />
        </AuthProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(auth.listener()).not.toBeNull());

    notifyListener()('SIGNED_IN', sessionFor('a', { issuedAtMs }));
    await waitFor(() =>
      expect(screen.getByTestId('session-user').textContent).toBe('a'),
    );
  }

  it('refreshes exactly once when a stale token regains focus', async () => {
    await renderSignedIn(Date.now() - 20 * 60 * 1000);

    fireEvent(window, new Event('focus'));

    await waitFor(() => expect(auth.refreshSession).toHaveBeenCalledTimes(1));
  });

  it('does not refresh a fresh token on focus', async () => {
    await renderSignedIn(Date.now() - 5 * 60 * 1000);

    fireEvent(window, new Event('focus'));

    expect(auth.refreshSession).not.toHaveBeenCalled();
  });

  it('never refreshes more than once per minute', async () => {
    await renderSignedIn(Date.now() - 20 * 60 * 1000);

    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(auth.refreshSession).toHaveBeenCalledTimes(1));

    // 30s later: token is even more stale, but inside the one-minute
    // cooldown from the first refresh — must be skipped.
    vi.setSystemTime(new Date(Date.now() + 30 * 1000));
    fireEvent(window, new Event('focus'));
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);

    // Just past the one-minute cooldown: a focus refreshes again.
    vi.setSystemTime(new Date(Date.now() + 31 * 1000));
    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(auth.refreshSession).toHaveBeenCalledTimes(2));
  });

  it('leaves the current session and claims untouched when the refresh fails', async () => {
    auth.refreshSession.mockRejectedValueOnce(new Error('network down'));
    await renderSignedIn(Date.now() - 20 * 60 * 1000);

    fireEvent(window, new Event('focus'));

    await waitFor(() => expect(auth.refreshSession).toHaveBeenCalledTimes(1));
    // No TOKEN_REFRESHED ever arrived (the mock never calls the listener on
    // refreshSession), so the session held here is exactly the one that was
    // signed in — nothing was cleared or replaced by the failed attempt.
    expect(screen.getByTestId('session-user').textContent).toBe('a');
  });

  it('ignores focus while the tab is not visible', async () => {
    await renderSignedIn(Date.now() - 20 * 60 * 1000);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

    fireEvent(window, new Event('focus'));

    expect(auth.refreshSession).not.toHaveBeenCalled();
  });
});
