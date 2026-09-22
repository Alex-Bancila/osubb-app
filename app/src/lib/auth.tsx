import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

/** What the JWT claims hook stamps into every member's token (spec §4.2). */
export type MemberClaims = {
  member_role: string;
  member_level: number;
  /** Legacy structure claims: nothing reads them; removed in #591. */
  dept_ids?: string[];
  team_ids?: string[];
  /**
   * Explicit Group memberships (ADR-0009 Wave 1); the Organization Group is
   * automatic and never listed. Stamped at token issue, so it can be up to an
   * hour stale: the Tracker decides membership from `my_groups()` instead.
   */
  group_ids: number[];
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

/**
 * How stale an access token may get before a regained focus refreshes it
 * (#598). Organization Claims are stamped once at token issue
 * (`jwt_expiry = 3600`), so without this a promotion, a confirmed Drept de
 * Vot, or a raised Minimum Level would not reach the Member's claims until
 * the token's hour ran out.
 */
const STALE_SESSION_THRESHOLD_MS = 15 * 60 * 1000;

/** Never attempt a refresh more often than this, even if focus/visibility
 * events fire in a burst. */
const REFRESH_COOLDOWN_MS = 60 * 1000;

/**
 * Unix ms the current access token was issued, derived from the pair the
 * real client always sets together (`expires_at` the timestamp it expires,
 * `expires_in` the lifetime in seconds counted from issue). `null` when
 * either is missing, so a caller skips the refresh instead of guessing.
 */
function tokenIssuedAtMs(session: Session): number | null {
  if (session.expires_at == null) return null;
  return (session.expires_at - session.expires_in) * 1000;
}

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
      group_ids: Array.isArray(meta.group_ids)
        ? (meta.group_ids as number[])
        : [],
    };
  } catch {
    // A token we cannot read is a token we do not trust.
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  // Everything cached belongs to one member. When the member changes — sign-out,
  // or a different account signing in on a shared device — drop it all before
  // the next render can show the previous person's data. Tracked as a ref and
  // compared inline in the auth callback (not derived from `session` in a
  // separate effect): two auth events firing back-to-back in the same tick —
  // exactly what a sign-out-then-sign-in-as-someone-else does — land in one
  // batched React render, so an effect keyed on the *final* session would see
  // no change at all and silently skip the clear. `lastUserId` starts `null`
  // so the very first observed session (nobody signed in yet, or a returning
  // member's stored session loading in) never wipes a legitimately warm cache.
  const lastUserId = useRef<string | null>(null);

  // Read by the focus/visibility refresh effect below, which registers its
  // listeners once (empty deps) and so cannot close over `session` directly.
  const sessionRef = useRef<Session | null>(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    let active = true;

    // What is in storage right now (a returning member, still signed in).
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      // Guard: onAuthStateChange can fire (e.g. SIGNED_IN for a different
      // member on a shared device) before this promise settles, since it is
      // registered synchronously right after this call but resolves later.
      // Only seed lastUserId here when nothing has claimed it yet — writing
      // unconditionally would let a slow-resolving stored session for member
      // A stomp the id an already-processed event just set for member B,
      // and the next real transition away from B would then compare against
      // A and silently skip the clear.
      if (lastUserId.current === null) {
        lastUserId.current = data.session?.user.id ?? null;
      }
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
      const nextUserId = next?.user.id ?? null;
      if (lastUserId.current !== null && lastUserId.current !== nextUserId) {
        queryClient.clear();
      }
      lastUserId.current = nextUserId;
      setSession(next);
      setLoading(false);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [queryClient]);

  // Bounded refresh on regained focus (#598): closes the gap where a member
  // just promoted, granted Drept de Vot, or raised past a Minimum Level
  // reads their own change as if it never happened, without a Realtime
  // dependency or a server change. `refreshSession()` failing leaves the
  // current session exactly as it was — `onAuthStateChange` above only ever
  // hears about a refresh that actually succeeded.
  useEffect(() => {
    let lastRefreshAt = 0;

    function refreshIfStale() {
      if (document.visibilityState !== 'visible') return;

      const current = sessionRef.current;
      if (!current) return;

      const issuedAt = tokenIssuedAtMs(current);
      if (issuedAt == null) return;

      const now = Date.now();
      if (now - issuedAt < STALE_SESSION_THRESHOLD_MS) return;
      if (now - lastRefreshAt < REFRESH_COOLDOWN_MS) return;

      lastRefreshAt = now;
      void supabase.auth.refreshSession().catch(() => undefined);
    }

    document.addEventListener('visibilitychange', refreshIfStale);
    window.addEventListener('focus', refreshIfStale);
    return () => {
      document.removeEventListener('visibilitychange', refreshIfStale);
      window.removeEventListener('focus', refreshIfStale);
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
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        queryClient.clear();
      },
    }),
    [session, claims, loading, queryClient],
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
