// The one shape every Edge Function error body takes (security pass
// 2026-09-27, L4): a stable reason `code` the app can map
// (app/src/lib/command-reasons.ts) and a fixed, human-readable `error`
// message. Nothing else — no environment-variable names, no database or
// PostgREST error text, no stack. The details go to console.error, which only
// the project's function logs show.
//
// `_shared/error-hygiene.test.ts` drives every handler's error paths with
// dependencies that fail loudly and fails if any body carries more.

export interface ErrorBody {
  code: string;
  error: string;
}

export function errorBody(code: string, error: string): ErrorBody {
  return { code, error };
}
