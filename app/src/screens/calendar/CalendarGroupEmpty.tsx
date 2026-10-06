import { CalendarSearch } from 'lucide-react';

import { EmptyState } from '../../components/layout';
import { Button } from '../../components/ui/button';
import type { WorkFilterState } from '../../lib/use-work-filter';

/**
 * The Calendar's calm answer when the chosen Group holds nothing in view
 * (ruling R40): the Group filter is always offered, so a Group with no Event
 * or deadline that month is a normal choice, not an error. One way out — show
 * every Group again — keeps the dates, so the member stays on the same month.
 */
export function CalendarGroupEmpty({
  filter,
  children,
}: {
  filter: WorkFilterState;
  children: string;
}) {
  return (
    <EmptyState
      bare
      icon={CalendarSearch}
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          // Clearing the root clears the Subgrup with it; a link carrying
          // only a Subgrup clears that.
          onClick={() =>
            filter.set(
              filter.value.rootGroupId !== undefined
                ? 'rootGroupId'
                : 'groupId',
              undefined,
            )
          }
        >
          Arată toate grupurile
        </Button>
      }
    >
      {children}
    </EmptyState>
  );
}
