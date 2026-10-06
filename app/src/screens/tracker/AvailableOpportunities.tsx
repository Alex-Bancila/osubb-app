import { EmptyState, Panel } from '../../components/layout';
import { formatTaskCount } from '../../lib/format';
import { useWorkFilter } from '../../lib/use-work-filter';
import { matchesWorkFilter } from '../../lib/work-filter';
import { usePreferredGroups } from '../../components/preferred-groups/preferred-groups';
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
  // R43: Disponibile opens on the preferred Groups.
  const preferred = usePreferredGroups();
  const shown = params
    ? opportunities.filter(
        (task) =>
          matchesWorkFilter(task, params) && preferred.keepGroup(task.group_id),
      )
    : [];
  return (
    <div className="space-y-6">
      <TrackerWorkFilter rows={opportunities} />
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
            <EmptyState bare>
              {active
                ? 'Nicio oportunitate nu corespunde filtrelor.'
                : preferred.active && opportunities.length > 0
                  ? 'Nicio oportunitate în grupurile tale preferate.'
                  : 'Nu sunt oportunități deschise pentru tine.'}
            </EmptyState>
          )}
        </Panel>
      )}
    </div>
  );
}
