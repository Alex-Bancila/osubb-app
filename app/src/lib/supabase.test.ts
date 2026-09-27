import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/*
 * The client's sign-in flow (security audit F4). supabase-js defaults to the
 * implicit flow and reads `#access_token=…` on any page, which signs the
 * visitor into whichever account the tokens belong to. These tests drive the
 * real auth client against a fetch stub that would accept those tokens.
 */

const ATTACKER = {
  id: '00000000-0000-4000-8000-000000000001',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'attacker@example.test',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-09-27T00:00:00Z',
};

const tokensInFragment =
  '/#access_token=attacker-access&refresh_token=attacker-refresh&expires_in=3600&token_type=bearer';

function acceptingFetch() {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(ATTACKER), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
}

let clientAuthOptions: typeof import('./supabase').clientAuthOptions;

beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');
  ({ clientAuthOptions } = await import('./supabase'));
});

afterEach(() => {
  window.history.replaceState({}, '', '/');
  window.localStorage.clear();
});

describe('the shared Supabase client', () => {
  it('runs the PKCE flow and leaves the URL to /auth/callback', () => {
    expect(clientAuthOptions).toEqual({
      flowType: 'pkce',
      detectSessionInUrl: false,
    });
  });

  it('never signs in from tokens in the URL fragment', async () => {
    window.history.replaceState({}, '', tokensInFragment);
    const fetch = acceptingFetch();
    const client = createClient('http://127.0.0.1:54321', 'test-anon-key', {
      auth: { ...clientAuthOptions, storageKey: 'test-pkce' },
      global: { fetch },
    });

    const { data } = await client.auth.getSession();

    expect(data.session).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('control: the library default would have signed in from that fragment', async () => {
    window.history.replaceState({}, '', tokensInFragment);
    const fetch = acceptingFetch();
    const client = createClient('http://127.0.0.1:54321', 'test-anon-key', {
      auth: { storageKey: 'test-default' },
      global: { fetch },
    });

    const { data } = await client.auth.getSession();

    expect(data.session?.user.email).toBe(ATTACKER.email);
  });
});
