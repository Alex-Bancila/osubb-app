# Refresh Stale Claims on Focus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh a signed-in Member's Supabase session when a token with stale organization claims returns to the foreground.

**Architecture:** Extend `AuthProvider` with a single event coordinator that reads the JWT `iat`, listens for window focus and visible documents, and asks Supabase to refresh only when the token is at least 15 minutes old. Reuse the existing auth-state callback as the sole session owner, with one in-flight promise and a one-minute attempt cooldown.

**Tech Stack:** React 19, TypeScript 6, Supabase JS 2.112+, Vitest 4, Testing Library

**Spec:** `docs/superpowers/specs/2026-09-20-stabilization-member-auth-design.md`

## Global Constraints

- Work on `feat/598-refresh-session-on-focus`, based on current `origin/main`, in an isolated worktree.
- Modify only `app/src/lib/auth.tsx` and `app/src/lib/auth.test.tsx`.
- Refresh at token age `>= 15 * 60 * 1000` milliseconds.
- Start a `60 * 1000` millisecond cooldown at attempt time, including failed attempts.
- Never write a refresh result into React state directly; `onAuthStateChange` owns session updates.
- Signed-out, malformed, or missing/non-numeric `iat` tokens do nothing.
- Do not review or merge any pull request.

---

### Task 1: Specify the foreground refresh coordinator

**Files:**

- Modify: `app/src/lib/auth.test.tsx`
- Test: `app/src/lib/auth.test.tsx`

**Interfaces:**

- Consumes: `supabase.auth.refreshSession(): Promise<{ data: { session: Session | null; user: User | null }; error: AuthError | null }>`.
- Produces: browser-event behavior observable through stable Member claims and refresh call count.

- [ ] **Step 1: Extend the complete auth mock**

Add a `refreshSession` mock returning the real documented response shape and include it under `supabase.auth`:

```ts
refreshSession: vi.fn(async () => ({
  data: { session: null, user: null },
  error: null as Error | null,
})),
```

- [ ] **Step 2: Let token fixtures carry a numeric `iat`**

Change the token helper to encode both fields in the real payload shape:

```ts
function tokenWithAppMetadata(appMetadata: unknown, issuedAt?: number): string {
  const json = JSON.stringify({ app_metadata: appMetadata, iat: issuedAt });
  // existing base64url conversion
}
```

- [ ] **Step 3: Add failing boundary tests with fake time**

At fixed time `2026-09-20T12:00:00Z`, add separate tests proving:

- age 14:59 does not refresh on focus;
- age exactly 15:00 refreshes once on focus;
- hidden `visibilitychange` does nothing and visible does refresh;
- focus plus visible visibility change while the first promise is pending calls refresh once;
- another event inside 60 seconds does nothing, including after returned error and rejected promise;
- current claims remain rendered after either failure form; and
- unmount removes the exact focus and visibility listeners.

Use literal `iat` seconds derived from the fixed timestamp and restore fake timers/document visibility after each test.

- [ ] **Step 4: Run the focused tests to verify red**

Run: `npm --prefix app run test:run -- src/lib/auth.test.tsx`.

Expected: the new tests fail because no listeners or `refreshSession` coordinator exist.

### Task 2: Decode `iat` and coordinate refresh attempts

**Files:**

- Modify: `app/src/lib/auth.tsx`
- Test: `app/src/lib/auth.test.tsx`

**Interfaces:**

- Produces: `decodeTokenPayload(accessToken): { app_metadata?: Record<string, unknown>; iat?: unknown } | null` and internal foreground handlers.
- Consumes: the current session through a ref updated by `getSession` and `onAuthStateChange`.

- [ ] **Step 1: Extract one token-payload decoder**

Move the existing base64url decode into:

```ts
type TokenPayload = {
  app_metadata?: Record<string, unknown>;
  iat?: unknown;
};

function decodeTokenPayload(accessToken: string): TokenPayload | null {
  // existing split, base64url normalization, TextDecoder, and JSON.parse
}
```

Make `decodeClaims` read `decodeTokenPayload(accessToken)?.app_metadata`, preserving all existing claim behavior.

- [ ] **Step 2: Add stable refs and exact thresholds**

Inside `AuthProvider`, add:

```ts
const currentSession = useRef<Session | null>(null);
const refreshInFlight = useRef<Promise<void> | null>(null);
const lastRefreshAttemptAt = useRef<number | null>(null);
const staleAfterMs = 15 * 60 * 1000;
const retryAfterMs = 60 * 1000;
```

Update `currentSession.current` whenever the stored session or auth callback is accepted.

- [ ] **Step 3: Implement the no-throw refresh attempt**

The handler reads the current token payload and returns unless `iat` is numeric, the age is at least 15 minutes, no request is running, and the last attempt was at least one minute ago. Set the cooldown timestamp before calling Supabase. Observe both returned errors and rejected promises, but do not throw and do not mutate `session`:

```ts
const attemptRefresh = () => {
  const current = currentSession.current;
  const issuedAt = current
    ? decodeTokenPayload(current.access_token)?.iat
    : null;
  const now = Date.now();
  if (typeof issuedAt !== "number" || now - issuedAt * 1000 < staleAfterMs)
    return;
  if (refreshInFlight.current) return;
  if (
    lastRefreshAttemptAt.current !== null &&
    now - lastRefreshAttemptAt.current < retryAfterMs
  )
    return;

  lastRefreshAttemptAt.current = now;
  const request = supabase.auth
    .refreshSession()
    .then(({ error }) => {
      if (error) return;
    })
    .catch(() => undefined)
    .finally(() => {
      if (refreshInFlight.current === request) refreshInFlight.current = null;
    });
  refreshInFlight.current = request;
};
```

- [ ] **Step 4: Install and clean up both browser listeners**

Register `window.addEventListener('focus', attemptRefresh)` and a `visibilitychange` handler that calls it only when `document.visibilityState === 'visible'`. Remove both exact function references in the provider cleanup beside the auth unsubscribe.

- [ ] **Step 5: Run the focused tests to verify green**

Run: `npm --prefix app run test:run -- src/lib/auth.test.tsx`.

Expected: all auth tests pass with no unhandled rejection or React warning.

### Task 3: Run frontend gates and commit

**Files:**

- Verify: `app/src/lib/auth.tsx`
- Verify: `app/src/lib/auth.test.tsx`

**Interfaces:**

- Consumes: the completed coordinator.
- Produces: a shippable #598 branch.

- [ ] **Step 1: Format and inspect**

Run `npm --prefix app run format -- src/lib/auth.tsx src/lib/auth.test.tsx`, then `git diff --check` and inspect the two-file diff.

Expected: no formatting or unrelated file changes.

- [ ] **Step 2: Run the complete frontend gate**

Run:

```bash
npm --prefix app run typecheck
npm --prefix app run lint
npm --prefix app run format:check
npm --prefix app run test:run
npm --prefix app run build
```

Expected: every command exits 0.

- [ ] **Step 3: Commit the issue change**

```bash
git add app/src/lib/auth.tsx app/src/lib/auth.test.tsx
git commit -m "fix(auth): refresh stale claims on focus"
```
