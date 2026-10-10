import { EmptyState, Panel } from '../../components/layout';
import { formatTaskCount } from '../../lib/format';
import { useWorkFilter } from '../../lib/use-work-filter';
import { matchesWorkFilter } from '../../lib/work-filter';
import { usePreferredGroups } from '../../components/preferred-groups/preferred-groups';
import type { Opportunity } from '../../queries/task-opportunities';
import { TaskCardGrid } from './TaskCardGrid';
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
 * — each card in its Group colour (the Organization Group's in OSUBB red), in
 * the query's deadline order.
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
