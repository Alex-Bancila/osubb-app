import { queryErrorMessage } from '../../lib/query-error';
import { Button } from '../ui/button';
import { EmptyState, stateBoxClass } from '../layout/EmptyState';

/**
 * The three states every query renders (mini-spec §5). They live together
 * because they are one decision — "what does this screen show when there is no
 * data yet, no data at all, or no answer" — and screens should make it the same
 * way every time. `Empty` and `ErrorState` share `EmptyState`'s `py-8` rhythm
 * (ruling R27); `Loading` holds the place of the rows that are coming.
 */

/**
 * Loading is the shape of what is coming, not a sentence about it: three
 * placeholder rows that pulse where the list will be, so the page does not
 * jump when the data lands. The label is still said to a screen reader.
 */
export function Loading({ label = 'Se încarcă…' }: { label?: string }) {
  return (
    <div
      className="flex w-full flex-col gap-3"
      role="status"
      data-slot="loading-state"
    >
      <span className="sr-only">{label}</span>
      {[1, 0.7, 0.4].map((opacity) => (
        <span
          key={opacity}
          aria-hidden="true"
          data-slot="skeleton"
          className="block h-16 animate-pulse rounded-md bg-muted motion-reduce:animate-none"
          style={{ opacity }}
        />
      ))}
    </div>
  );
}

/**
 * An empty list is not a failure, and must never read like one. Say what would
 * be here — "Niciun task deschis acum" tells a member the tracker works and
 * there is simply nothing to claim; "Nicio informație" tells them nothing.
 */
export function Empty({ text, bare }: { text: string; bare?: boolean }) {
  return <EmptyState bare={bare}>{text}</EmptyState>;
}

/**
 * Something went wrong, in words a member can act on — never a raw Postgres
 * string. The real error still reaches the console in development, because the
 * person who needs `column "titel" does not exist` is you, not them.
 */
export function ErrorState({
  onRetry,
  error,
  text,
  retryLabel = 'Încearcă din nou',
}: {
  onRetry?: () => void;
  error?: unknown;
  text?: string;
  retryLabel?: string;
}) {
  if (import.meta.env.DEV && error) console.error('[query]', error);

  return (
    <div className={stateBoxClass} role="alert" data-slot="error-state">
      <p className="m-0 text-sm text-muted-foreground">
        {text ?? queryErrorMessage(error)}
      </p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
