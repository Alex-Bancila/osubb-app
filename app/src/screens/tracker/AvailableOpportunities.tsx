import { useId } from 'react';
import { Empty, EmptyHeader, EmptyTitle } from '../../components/ui/empty';
import { formatTaskCount } from '../../lib/format';
import { useWorkFilter } from '../../lib/use-work-filter';
import { matchesWorkFilter } from '../../lib/work-filter';
import type { Opportunity } from '../../queries/task-opportunities';
import { TaskCardGrid } from './TaskCardGrid';
import { RANGE_FIRST, TrackerWorkFilter } from './TrackerWorkFilter';

function BandHeading({
  id,
  title,
  count,
}: {
  id: string;
  title: string;
  count: number;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      <p className="text-sm text-muted-foreground tabular-nums">
        {formatTaskCount(count)}
      </p>
    </div>
  );
}

/**
 * Disponibile (ruling R10, #686): under the Work Filter, the Opportunities of
 * the Member's own Groups in their Group colour (the Organization Group's in
 * OSUBB red), then — greyed, behind a dashed rule — **Alte oportunități
 * OSUBB**: the open Opportunities of Groups the Member is not in. Both bands
 * keep the query's deadline order; the lower band is omitted when empty.
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
  const ownId = useId();
  const otherId = useId();
  const shown = params
    ? opportunities.filter((task) => matchesWorkFilter(task, params))
    : [];
  const own = shown.filter((task) => task.relevant);
  const other = shown.filter((task) => !task.relevant);
  return (
    <div className="space-y-6">
      <TrackerWorkFilter hint="Grupul include toate subgrupurile sale; perioada se aplică termenului taskului." />
      {!params ? (
        <p>{RANGE_FIRST}</p>
      ) : (
        <>
          <section
            aria-labelledby={ownId}
            data-band="own"
            className="min-w-0 space-y-3"
          >
            <BandHeading
              id={ownId}
              title="Din grupurile mele"
              count={own.length}
            />
            {own.length ? (
              <TaskCardGrid
                rows={own}
                now={now}
                onOpenTask={onOpenTask}
                card={(task) => ({
                  allowInterest: true,
                  joinable: task.joinable,
                  band: 'own',
                  titleLevel: 3,
                })}
              />
            ) : (
              <Empty className="border border-dashed border-border">
                <EmptyHeader>
                  <EmptyTitle>
                    {active
                      ? 'Nicio oportunitate din grupurile tale nu corespunde filtrelor.'
                      : 'Nu sunt oportunități în grupurile tale.'}
                  </EmptyTitle>
                </EmptyHeader>
              </Empty>
            )}
          </section>
          {other.length > 0 && (
            <section
              aria-labelledby={otherId}
              data-band="other"
              className="min-w-0 space-y-3 border-t border-dashed border-border pt-6"
            >
              <BandHeading
                id={otherId}
                title="Alte oportunități OSUBB"
                count={other.length}
              />
              <p className="text-sm text-muted-foreground">
                Din grupurile în care nu ești. Te poți înscrie la cele deschise
                întregului OSUBB.
              </p>
              <TaskCardGrid
                rows={other}
                now={now}
                onOpenTask={onOpenTask}
                card={(task) => ({
                  allowInterest: true,
                  joinable: task.joinable,
                  band: 'other',
                  titleLevel: 3,
                })}
              />
            </section>
          )}
        </>
      )}
    </div>
  );
}
