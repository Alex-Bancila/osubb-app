import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

/* The one client the whole app shares. Everything — queries, auth, realtime
   later — goes through this instance; creating a second one would mean two
   session stores fighting over the same localStorage key.

   Both values are safe to ship in the bundle: the anon key is a *public*
   key, and it grants nothing on its own. What a request may actually read or
   write is decided by RLS from the member's token, in the database. That is why
   there is no service key anywhere in `app/` and never will be — that one is a
   real secret and lives only in Edge Functions and CI. */
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy app/.env.example to app/.env.local and restart `npm run dev`.',
  );
}

/* PKCE, and the client never reads a session out of the URL by itself.

   The default (implicit) flow accepts `#access_token=…&refresh_token=…` on
   any page, which signs whoever opens such a link into the account the tokens
   belong to — a login CSRF that needs no click. Every emailed link now lands
   on `/auth/confirm?token_hash=…` (`verifyOtp`, independent of the flow), so
   nothing legitimate sends that shape any more. Under PKCE a `?code=` is
   worth nothing without the verifier this browser stored when it asked for
   the link, and `/auth/callback` is the one place that exchanges it — with
   `detectSessionInUrl` on, the client would race it for the same code. */
export const clientAuthOptions = {
  flowType: 'pkce',
  detectSessionInUrl: false,
} as const;

/* Typed with the generated `Database`, so `.from('taskss')` and
   `.select('titel')` are build errors rather than empty results at the demo.
   `database.types.ts` is generated — never edit it by hand; run
   `npm run gen:types` after a migration and commit what comes out. CI
   regenerates it and fails if the committed copy has drifted. */
export const supabase = createClient<Database>(url, anonKey, {
  auth: clientAuthOptions,
});

/* Dev convenience: poke at the client from the browser console —
   `await __supabase.from('tasks').select('*')` is the fastest way to find out
   whether a screen is empty because of a bug or because RLS says so. Stripped
   from production builds (import.meta.env.DEV is a compile-time constant). */
if (import.meta.env.DEV) {
  (window as unknown as { __supabase: typeof supabase }).__supabase = supabase;
}
