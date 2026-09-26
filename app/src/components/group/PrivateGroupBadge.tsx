import { LockKeyhole } from 'lucide-react';
import { Badge } from '../ui/badge';

/**
 * The mark of a Private Group (ruling R25): a lock and the word **Privat**,
 * beside the Group's name wherever it renders. Whoever sees it may already see
 * the Group — the database decides that — so the badge only tells a viewer why
 * the Group accepts no Applications and no organization-wide Audience.
 *
 * `compact` is for chips, where a second pill would crowd the name: the lock
 * alone, with the word kept for screen readers. Renders nothing for a public
 * Group, so a caller never branches on it.
 */
export function PrivateGroupBadge({
  isPrivate,
  compact = false,
}: {
  isPrivate: boolean | null | undefined;
  compact?: boolean;
}) {
  if (!isPrivate) return null;
  if (compact)
    return (
      <span
        title="Grup privat"
        className="inline-flex shrink-0 items-center text-muted-foreground"
      >
        <LockKeyhole aria-hidden="true" className="size-3" />
        <span className="sr-only">Privat</span>
      </span>
    );
  return (
    <Badge variant="outline" title="Grup privat" className="shrink-0">
      <LockKeyhole aria-hidden="true" />
      Privat
    </Badge>
  );
}
