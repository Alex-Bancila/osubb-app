import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

/** What the JWT claims hook stamps into every member's token (spec §4.2). */
export type MemberClaims = {
  member_role: string;
  member_level: number;
  dept_ids: string[];
  team_ids: string[];
};

export type AuthState = {
  /** Supabase session, or null when signed out. */
  session: Session | null;
  /**
   * Org claims, or null when the signed-in account is not an active member.
   * `session && !claims` is not an error — it is ADR-0003 working, and it has
   * its own screen (#85). Never render an empty dashboard for it.
   */
  claims: MemberClaims | null;
  /** True until the stored session has been read; render nothing decisive yet. */
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

/* ⚠️ The claims are NOT on `session.user.app_metadata`.
   That object comes from the user record and holds only provider info —
   reading `session.user.app_metadata.member_role` returns undefined, silently,
   and every screen looks empty for everyone. Verified against the local stack:
   the hook writes into the *token's* claims, so the only place `member_role`
   exists is inside the access token. Hence this decode. */
function decodeClaims(accessToken: string): MemberClaims | null {
  try {
    const payload = accessToken.split('.')[1];
    if (!payload) return null;

    // base64url → base64, then pad: JWT segments carry no '=' padding.
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const json = new TextDecoder().decode(
      Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)),
    );

    const meta = (
      JSON.parse(json) as { app_metadata?: Record<string, unknown> }
    ).app_metadata;

    // No member_role means no membership: never invited, or deactivated since
    // this token was issued (ADR-0003 gate 2). Treat it as "not a member",
    // exactly as the database does.
    if (!meta || typeof meta.member_role !== 'string') return null;

    return {
      member_role: meta.member_role,
      member_level: Number(meta.member_level ?? 0),
      dept_ids: Array.isArray(meta.dept_ids) ? (meta.dept_ids as string[]) : [],
      team_ids: Array.isArray(meta.team_ids) ? (meta.team_ids as string[]) : [],
    };
  } catch {
    // A token we cannot read is a token we do not trust.
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    // What is in storage right now (a returning member, still signed in).
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });

    // Everything after that: sign-in, sign-out, and — the one that matters for
    // us — TOKEN_REFRESHED. A member BC deactivates keeps working until their
    // token expires; the refreshed one arrives without claims, and because we
    // re-decode on every session change, the app follows the database within
    // the hour rather than staying stale until a manual reload.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      setSession(next);
      setLoading(false);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Decoded once per session object, not once per render or per query.
  const claims = useMemo(
    () => (session ? decodeClaims(session.access_token) : null),
    [session],
  );

  const value = useMemo<AuthState>(
    () => ({
      session,
      claims,
      loading,
      signOut: async () => {
        await supabase.auth.signOut();
      },
    }),
    [session, claims, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * The only place the app reads who is signed in.
 *
 * Never query the database to find out who you are — the token already says,
 * which is the entire point of the claims design (mini-spec §4). And remember
 * that level checks here are cosmetic: they hide a tab or disable a button. The
 * database is what actually refuses.
 */
// The provider and its hook belong in one module — the mini-spec §2 puts both
// in lib/auth.tsx, and that is where a teammate will look for them. The cost is
// losing Fast Refresh for this one file, which almost never changes; the
// benefit is that `npm run lint` stays silent, so a real warning is visible.
// oxlint-disable-next-line react/only-export-components
export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth() must be used inside <AuthProvider>');
  return value;
}
