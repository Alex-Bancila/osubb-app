import { useMemo } from 'react';
import { EmptyState, Panel } from '../../components/layout';
import { formatTaskCount } from '../../lib/format';
import { useWorkFilter } from '../../lib/use-work-filter';
import { matchesWorkFilter } from '../../lib/work-filter';
import { usePreferredGroups } from '../../components/preferred-groups/preferred-groups';
import type { Opportunity } from '../../queries/task-opportunities';
import { useQueuePositions, type OwnTaskQueue } from '../../queries/task-queue';
import { TaskRowList } from './TaskRowList';
import {
  ClearSearchButton,
  RANGE_FIRST,
  trackerListClass,
  TrackerWorkFilter,
} from './TrackerWorkFilter';
import { matchesTitle, type TitleSearch } from './use-title-search';

/**
 * Disponibile (ruling R26, #795): under the Tracker's toolbar — the title
 * search and the Work Filter — one band of open
 * Opportunities — the Member's own Groups' and every Group's org-Audience ones
 * — each row in its Group colour (the Organization Group's in OSUBB red), in
 * the query's deadline order. Each row's own state comes from its list row,
 * and the places in the queues the Member waits on from one read for them
 * all (#1133): no row asks anything of its own.
 */
export function AvailableOpportunities({
  opportunities,
  now,
  search,
  onOpenTask,
}: {
  opportunities: readonly Opportunity[];
  now: Date;
  search: TitleSearch;
  onOpenTask: (id: number) => void;
}) {
  const { params, active } = useWorkFilter();
  const waitingOn = useMemo(
    () =>
      opportunities
        .filter((task) => task.candidature === 'pending')
        .map((task) => task.id),
    [opportunities],
  );
  const positions = useQueuePositions(waitingOn);
  // One object a row, kept while neither read changes: a row's props stay
  // the same between renders.
  const queues = useMemo(
    () =>
      new Map<number, OwnTaskQueue>(
        opportunities.map((task) => [
          task.id,
          {
            status: task.candidature,
            position:
              task.candidature === 'pending'
                ? (positions.data?.get(task.id) ?? null)
                : null,
          },
        ]),
      ),
    [opportunities, positions.data],
  );
  // R43: Disponibile opens on the preferred Groups.
  const preferred = usePreferredGroups();
  const shown = params
    ? opportunities.filter(
        (task) =>
          matchesWorkFilter(task, params) &&
          preferred.keepGroup(task.group_id) &&
          matchesTitle(task.title, search.needle),
      )
    : [];
  return (
    <div className={trackerListClass}>
      <TrackerWorkFilter
        rows={opportunities}
        search={search}
        count={params ? shown.length : undefined}
      />
      {!params ? (
        <p>{RANGE_FIRST}</p>
      ) : (
        <Panel
          bare
          title="Oportunități deschise"
          control={
            <p className="text-sm text-muted-foreground tabular-nums">
              {formatTaskCount(shown.length)}
            </p>
          }
        >
          {shown.length ? (
            <TaskRowList
              rows={shown}
              now={now}
              onOpenTask={onOpenTask}
              row={(task) => ({
                allowInterest: true,
                joinable: task.joinable,
                queue: queues.get(task.id),
                titleLevel: 3,
              })}
            />
          ) : (
            <EmptyState
              bare
              action={
                opportunities.length > 0 && search.needle ? (
                  <ClearSearchButton search={search} />
                ) : null
              }
            >
              {!opportunities.length
                ? 'Nu sunt oportunități deschise pentru tine.'
                : search.needle
                  ? 'Nicio oportunitate nu corespunde căutării.'
                  : active
                    ? 'Nicio oportunitate nu corespunde filtrelor.'
                    : preferred.active
                      ? 'Nicio oportunitate în grupurile tale preferate.'
                      : 'Nu sunt oportunități deschise pentru tine.'}
            </EmptyState>
          )}
        </Panel>
      )}
    </div>
  );
}
