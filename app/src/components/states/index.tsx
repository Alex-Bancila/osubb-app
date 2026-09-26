import { queryErrorMessage } from '../../lib/query-error';
import { LoaderCircle } from 'lucide-react';
import { Button } from '../ui/button';

/**
 * The three states every query renders (mini-spec §5). They live together
 * because they are one decision — "what does this screen show when there is no
 * data yet, no data at all, or no answer" — and screens should make it the same
 * way every time.
 */

export function Loading({ label = 'Se încarcă…' }: { label?: string }) {
  return (
    <div className="state" role="status">
      <LoaderCircle
        className="size-5 animate-spin motion-reduce:animate-none"
        aria-hidden="true"
      />
      <p className="state-text">{label}</p>
    </div>
  );
}

/**
 * An empty list is not a failure, and must never read like one. Say what would
 * be here — "Niciun task deschis acum" tells a member the tracker works and
 * there is simply nothing to claim; "Nicio informație" tells them nothing.
 */
export function Empty({ text }: { text: string }) {
  return (
    <div className="state">
      <p className="state-text">{text}</p>
    </div>
  );
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
}: {
  onRetry?: () => void;
  error?: unknown;
  text?: string;
}) {
  if (import.meta.env.DEV && error) console.error('[query]', error);

  return (
    <div className="state" role="alert">
      <p className="state-text">{text ?? queryErrorMessage(error)}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Încearcă din nou
        </Button>
      )}
    </div>
  );
}
