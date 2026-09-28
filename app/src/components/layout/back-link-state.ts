import type { Location } from 'react-router';

/** Where a back link goes, and the words it says. */
export type BackLinkTarget = {
  /** An in-app path, with its search and hash (`/clasament?grup=8`). */
  to: string;
  label: string;
};

/** The shape a caller puts in `location.state` so the next page can go back. */
export type BackLinkState = { from: BackLinkTarget };

/**
 * The `state` to pass on a link so the page it opens has a `BackLink` to
 * here: `<Link to="/tracker/membru/1" state={backLinkState(location)}>`.
 */
export function backLinkState(
  location: Pick<Location, 'pathname' | 'search'> & { hash?: string },
  label = 'Înapoi',
): BackLinkState {
  return {
    from: {
      to: location.pathname + location.search + (location.hash ?? ''),
      label,
    },
  };
}

/** `state.from` when it is a well-formed in-app target, else `null`. */
export function readBackLinkState(state: unknown): BackLinkTarget | null {
  if (typeof state !== 'object' || state === null || !('from' in state))
    return null;
  const from = (state as { from: unknown }).from;
  if (typeof from !== 'object' || from === null) return null;
  const { to, label } = from as Partial<Record<'to' | 'label', unknown>>;
  // Only a path inside the app: never another origin ("//evil", "https:").
  if (typeof to !== 'string' || !to.startsWith('/') || to.startsWith('//'))
    return null;
  if (typeof label !== 'string' || !label.trim()) return null;
  return { to, label };
}
