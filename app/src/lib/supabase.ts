import { createClient } from '@supabase/supabase-js';

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

export const supabase = createClient(url, anonKey);

/* Dev convenience: poke at the client from the browser console —
   `await __supabase.from('tasks').select('*')` is the fastest way to find out
   whether a screen is empty because of a bug or because RLS says so. Stripped
   from production builds (import.meta.env.DEV is a compile-time constant). */
if (import.meta.env.DEV) {
  (window as unknown as { __supabase: typeof supabase }).__supabase = supabase;
}
