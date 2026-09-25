import { useId } from 'react';
import { Empty, EmptyHeader, EmptyTitle } from '../../components/ui/empty';
import { formatTaskCount } from '../../lib/format';
import { useWorkFilter } from '../../lib/use-work-filter';
import { matchesWorkFilter } from '../../lib/work-filter';
import type { Opportunity } from '../../queries/task-opportunities';
import { TaskCardGrid } from './TaskCardGrid';
import { RANGE_FIRST, TrackerWorkFilter } from './TrackerWorkFilter';

/**
 * Disponibile (ruling R26, #795): under the Work Filter, one band of open
 * Opportunities — the Member's own Groups' and every Group's org-Audience ones
 * — each card in its Group colour (the Organization Group's in OSUBB red), in
 * the query's deadline order.
 */
export function AvailableOpportunities({
  opportunities,
  now,
  onOpenTask,
}: {
  opportunities: readonly Opportunity[];
  now: Date;
  onOpenTask: (id: number) => void;
}) {
  const { params, active } = useWorkFilter();
  const headingId = useId();
  const shown = params
    ? opportunities.filter((task) => matchesWorkFilter(task, params))
    : [];
  return (
    <div className="space-y-6">
      <TrackerWorkFilter hint="Grupul include toate subgrupurile sale; perioada se aplică termenului taskului." />
      {!params ? (
        <p>{RANGE_FIRST}</p>
      ) : (
        <section aria-labelledby={headingId} className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 id={headingId} className="text-lg font-semibold">
              Oportunități deschise
            </h2>
            <p className="text-sm text-muted-foreground tabular-nums">
              {formatTaskCount(shown.length)}
            </p>
          </div>
          {shown.length ? (
            <TaskCardGrid
              rows={shown}
              now={now}
              onOpenTask={onOpenTask}
              card={(task) => ({
                allowInterest: true,
                joinable: task.joinable,
                titleLevel: 3,
              })}
            />
          ) : (
            <Empty className="border border-dashed border-border">
              <EmptyHeader>
                <EmptyTitle>
                  {active
                    ? 'Nicio oportunitate nu corespunde filtrelor.'
                    : 'Nu sunt oportunități deschise pentru tine.'}
                </EmptyTitle>
              </EmptyHeader>
            </Empty>
          )}
        </section>
      )}
    </div>
  );
}
