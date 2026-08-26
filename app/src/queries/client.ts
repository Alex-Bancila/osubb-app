import { QueryClient } from '@tanstack/react-query';

/**
 * A refusal is an answer, not a fault.
 *
 * When RLS declines a read, PostgREST replies with a SQLSTATE — `42501`
 * (insufficient privilege) or a `PGRST` code — and retrying changes nothing
 * except how long the member waits to be told. Network trouble is the opposite:
 * worth one more go. So: retry once, unless the database has already given its
 * verdict.
 */
function isRefusal(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (typeof code !== 'string') return false;
  return code === '42501' || code.startsWith('PGRST') || /^4\d\d$/.test(code);
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (attempt, error) => attempt < 1 && !isRefusal(error),
        /* Half a minute of "fresh enough". Long enough that moving between two
           screens showing the same data does not re-fetch it, short enough that
           a leaderboard nobody would call stale. Realtime is scoped to the
           leaderboard and critical announcements later (spec §6); polling first,
           as the mini-spec says. */
        staleTime: 30_000,
        refetchOnWindowFocus: true,
      },
    },
  });
}
