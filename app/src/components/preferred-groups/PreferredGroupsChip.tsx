import { Link } from 'react-router';
import { Star } from 'lucide-react';
import { cn } from 'cn';
import { Button } from '../ui/button';
import {
  PREFERRED_GROUPS_ANCHOR,
  usePreferredGroups,
} from './preferred-groups';

/**
 * The quiet chip that says the page is filtered (R43): **Doar grupurile
 * preferate**, which leads to the Profil card, and **Arată tot** for this
 * visit; after that, **Toate grupurile** with the way back. Nothing for
 * anyone who has not unselected a Group.
 */
export function PreferredGroupsChip({ className }: { className?: string }) {
  const view = usePreferredGroups();
  if (!view.available) return null;
  return (
    <div
      data-slot="preferred-groups-chip"
      className={cn(
        'inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border border-border bg-muted/50 pl-3.5 text-sm',
        className,
      )}
    >
      <Star
        aria-hidden="true"
        className={cn(
          'size-3.5 shrink-0',
          view.active ? 'fill-primary text-primary' : 'text-muted-foreground',
        )}
      />
      {view.active ? (
        <Link
          to={`/profil#${PREFERRED_GROUPS_ANCHOR}`}
          className="inline-flex min-h-11 min-w-0 items-center truncate rounded-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
        >
          Doar grupurile preferate
        </Link>
      ) : (
        <span className="inline-flex min-h-11 items-center truncate text-muted-foreground">
          Toate grupurile
        </span>
      )}
      <span aria-hidden="true" className="text-muted-foreground">
        ·
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="rounded-full px-3.5"
        onClick={view.active ? view.showAll : view.showPreferred}
      >
        {view.active ? 'Arată tot' : 'Doar preferatele'}
      </Button>
    </div>
  );
}
