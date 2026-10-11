import { useMemo, useState } from 'react';
import { EmptyState } from '../../components/layout';
import { SegmentedRadio } from '../../components/ui/segmented-radio';
import { Select } from '../../components/ui/select';
import { workFilterCellClass } from '../../components/work-filter/field-class';
import { formatTaskCount } from '../../lib/format';
import { useWorkFilter } from '../../lib/use-work-filter';
import { matchesWorkFilter } from '../../lib/work-filter';
import { executesTask } from '../../lib/preferred-groups';
import { usePreferredGroups } from '../../components/preferred-groups/preferred-groups';
import {
  ClearSearchButton,
  RANGE_FIRST,
  trackerListClass,
  TrackerWorkFilter,
} from './TrackerWorkFilter';
import { matchesTitle, type TitleSearch } from './use-title-search';
import { TaskRow } from './TaskRow';
import {
  compareManagedTasks,
  MANAGER_TASK_STATES,
  matchesTaskState,
  type ManagerTaskSort,
} from './manager-task-list';
import {
  toTaskPresentation,
  type TaskPresentationRow,
} from './task-presentation';

/**
 * Stare and Ordonează appear from this many Tasks up: below it the whole list
 * fits on one screen (relevance B18). The title search is always there, as on
 * every Tracker list.
 */
export const LIST_CONTROLS_FROM = 6;

const SORT_CHOICES: ReadonlyArray<{ value: ManagerTaskSort; label: string }> = [
  { value: 'deadline', label: 'Termen' },
  { value: 'title', label: 'Titlu' },
];

/**
 * De gestionat and Toate (#687): the Tracker's toolbar (#903) — the title
 * search, whose placeholder says how many Tasks the list shows, then
 * Filtrează, whose sheet holds the Work Filter, Stare (only the states the
 * list holds) and the order (#845, layout T4) — then the Tasks as dense rows,
 * no table, so nothing scrolls sideways at any width. `empty` is what the
 * list says when it holds no Task at all.
 */
export function ManagerTaskList({
  rows,
  now,
  search,
  empty,
  onOpenTask,
}: {
  rows: readonly TaskPresentationRow[];
  now: Date;
  search: TitleSearch;
  empty: string;
  onOpenTask?: (id: number) => void;
}) {
  const { params } = useWorkFilter();
  // R43: the list opens on the preferred Groups; a Task the member executes
  // stays whatever its Group.
  const preferred = usePreferredGroups();
  const [chosenState, setState] = useState('');
  const [chosenSort, setSort] = useState<ManagerTaskSort>('deadline');
  const { needle } = search;

  const listControls = rows.length >= LIST_CONTROLS_FROM;
  const sort = listControls ? chosenSort : 'deadline';

  const presented = useMemo(
    () => rows.map((row) => ({ row, task: toTaskPresentation(row, now) })),
    [rows, now],
  );
  // Stare offers only the states the list holds; a chosen state the list
  // no longer holds is dropped rather than emptying the list.
  const states = useMemo(
    () =>
      MANAGER_TASK_STATES.filter(([value]) =>
        presented.some(({ task }) => matchesTaskState(task, value)),
      ),
    [presented],
  );
  const stateOffered =
    listControls && states.some(([value]) => value === chosenState);
  // Cleared, not just ignored, so a later row that brings the state back
  // does not silently filter by it again.
  if (chosenState && !stateOffered) setState('');
  const state = stateOffered ? chosenState : '';

  const tasks = useMemo(
    () =>
      params
        ? presented
            .filter(
              ({ row, task }) =>
                matchesWorkFilter(row, params) &&
                (preferred.keepGroup(row.group_id) ||
                  executesTask(row, preferred.memberId)) &&
                matchesTaskState(task, state) &&
                matchesTitle(task.title, needle),
            )
            .map(({ task }) => task)
            .sort(compareManagedTasks(sort))
        : [],
    [presented, params, state, needle, sort, preferred],
  );

  const fields = listControls
    ? (id: string) => (
        <>
          <label className={workFilterCellClass} htmlFor={`${id}-state`}>
            <span className="text-sm font-medium">Stare</span>
            <Select
              id={`${id}-state`}
              value={state}
              options={[
                { value: '', label: 'Toate stările' },
                ...states.map(([value, label]) => ({ value, label })),
              ]}
              onValueChange={setState}
            />
          </label>
          {/* Two choices: a segmented control, not a list (DESIGN.md). */}
          <div className={workFilterCellClass}>
            <span id={`${id}-sort`} className="text-sm font-medium">
              Ordonează după
            </span>
            <SegmentedRadio
              aria-labelledby={`${id}-sort`}
              value={sort}
              options={SORT_CHOICES}
              onValueChange={setSort}
            />
          </div>
        </>
      )
    : undefined;

  return (
    <div className={trackerListClass}>
      <TrackerWorkFilter
        rows={rows}
        search={search}
        count={params ? tasks.length : undefined}
        fields={fields}
        extraChips={
          state
            ? [
                {
                  key: 'state',
                  label: 'Stare',
                  text: states.find(([value]) => value === state)?.[1] ?? state,
                  onRemove: () => setState(''),
                },
              ]
            : []
        }
      />
      {!params ? (
        <p>{RANGE_FIRST}</p>
      ) : (
        <section aria-label="Lista taskurilor" className="min-w-0 space-y-2">
          {tasks.length ? (
            <>
              {/* Said to a screen reader; sighted, the search names it. */}
              <p role="status" className="sr-only">
                {formatTaskCount(tasks.length)}
              </p>
              <ul data-slot="task-row-list" className="grid min-w-0 gap-2 p-0">
                {tasks.map((task) => (
                  <li key={task.id} className="min-w-0">
                    <TaskRow task={task} onOpenTask={onOpenTask} />
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <EmptyState
              bare
              action={needle ? <ClearSearchButton search={search} /> : null}
            >
              {!rows.length
                ? empty
                : needle
                  ? 'Niciun task nu corespunde căutării.'
                  : preferred.active
                    ? 'Niciun task în grupurile tale preferate.'
                    : 'Niciun task nu corespunde filtrelor.'}
            </EmptyState>
          )}
        </section>
      )}
    </div>
  );
}
