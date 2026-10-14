import { useMemo, useState } from 'react';
import { AnimatedList, EmptyState, Panel } from '../../components/layout';
import { ErrorState, Loading } from '../../components/states';
import { Button } from '../../components/ui/button';
import { SegmentedRadio } from '../../components/ui/segmented-radio';
import { Select } from '../../components/ui/select';
import { workFilterCellClass } from '../../components/work-filter/field-class';
import { formatTaskCount } from '../../lib/format';
import { useInView } from '../../lib/use-in-view';
import { useWorkFilter } from '../../lib/use-work-filter';
import { matchesWorkFilter } from '../../lib/work-filter';
import { executesTask } from '../../lib/preferred-groups';
import { usePreferredGroups } from '../../components/preferred-groups/preferred-groups';
import {
  summaryWork,
  useFinishedTasks,
  useTaskListSummary,
  type FinishedFilters,
  type TaskListName,
} from '../../queries/task-lists';
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
  finishedStateCounts,
  isFinishedState,
  isOpenState,
  MANAGER_TASK_STATES,
  matchesTaskState,
  type ManagerTaskSort,
} from './manager-task-list';
import {
  isTerminalTask,
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
 *
 * The list has two parts (#1053, ruling R54). `rows` are its open Tasks, read
 * whole: the page filters and orders them, overdue first. The finished Tasks
 * follow under **Taskuri încheiate**, newest first, read from the server 50
 * at a time under the same search, filters, state and order — the next page
 * when the end of the list comes into view, or from **Încarcă mai multe**.
 * Stare and the Work Filter offer what both parts hold: the open rows, and
 * the server's summary of the rest.
 */
export function ManagerTaskList({
  list,
  rows,
  now,
  search,
  empty,
  onOpenTask,
}: {
  /** Which list this is; names the finished part's read. */
  list: TaskListName;
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

  // What the list holds beyond `rows`: its finished Tasks, counted.
  const summary = useTaskListSummary(list, true);
  const held = useMemo(
    () => (summary.data ?? []).filter((row) => isTerminalTask(row.status)),
    [summary.data],
  );
  const finishedCounts = useMemo(() => finishedStateCounts(held), [held]);
  const work = useMemo(() => [...rows, ...summaryWork(held)], [rows, held]);

  const listControls = rows.length + finishedCounts.total >= LIST_CONTROLS_FROM;
  const sort = listControls ? chosenSort : 'deadline';

  const presented = useMemo(
    () => rows.map((row) => ({ row, task: toTaskPresentation(row, now) })),
    [rows, now],
  );
  // Stare offers only the states the list holds; a chosen state the list
  // no longer holds is dropped rather than emptying the list.
  const states = useMemo(
    () =>
      MANAGER_TASK_STATES.filter(
        ([value]) =>
          presented.some(({ task }) => matchesTaskState(task, value)) ||
          (isFinishedState(value) && finishedCounts[value] > 0),
      ),
    [presented, finishedCounts],
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

  // The finished part's read: the same narrowing, applied by the server.
  // Nothing is asked while the range is inverted or Stare names a state only
  // an open Task can have.
  const finishedFilters = useMemo<FinishedFilters | null>(
    () =>
      !params || isOpenState(state)
        ? null
        : {
            ...params,
            ...(needle ? { p_search: needle } : {}),
            ...(isFinishedState(state) ? { p_state: state } : {}),
            ...(preferred.active ? { p_preferred: true } : {}),
            ...(sort === 'title' ? { p_sort: sort } : {}),
          },
    [params, state, needle, sort, preferred.active],
  );
  const finished = useFinishedTasks(list, finishedFilters, true);
  // A Task that has just finished can still be in the open read for a moment.
  const finishedTasks = useMemo(() => {
    const open = new Set(rows.map((row) => row.id));
    return finished.rows
      .filter((row) => !open.has(row.id))
      .map((row) => toTaskPresentation(row, now));
  }, [finished.rows, rows, now]);
  const sentinel = useInView(finished.loadMore, finished.rows.length);

  // How many Tasks the list shows; unknown until the finished part answers.
  const count =
    !params || finished.isPending || finished.isError
      ? undefined
      : tasks.length + (finished.total ?? 0);
  const nothing = tasks.length === 0 && finishedTasks.length === 0;
  const settled = !finished.isPending && !finished.isError;

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
        rows={work}
        search={search}
        count={count}
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
        <section
          aria-label="Lista taskurilor"
          className="flex min-w-0 flex-col gap-4"
        >
          {/* Said to a screen reader; sighted, the search names it. */}
          {count !== undefined && count > 0 && (
            <p role="status" className="sr-only">
              {formatTaskCount(count)}
            </p>
          )}
          {tasks.length > 0 && (
            <AnimatedList
              data-slot="task-row-list"
              className="gap-2"
              items={tasks}
              getKey={(task) => task.id}
            >
              {(task) => <TaskRow task={task} onOpenTask={onOpenTask} />}
            </AnimatedList>
          )}
          {finished.isPending && (
            <Loading label="Se încarcă taskurile încheiate…" />
          )}
          {finished.isError && (
            <ErrorState
              error={finished.error}
              text="Nu am putut încărca taskurile încheiate."
              onRetry={finished.refetch}
            />
          )}
          {finishedTasks.length > 0 && (
            <Panel
              bare
              title="Taskuri încheiate"
              control={
                finished.total !== undefined && (
                  <p className="text-sm text-muted-foreground tabular-nums">
                    {formatTaskCount(finished.total)}
                  </p>
                )
              }
            >
              <AnimatedList
                data-slot="task-row-list"
                className="gap-2"
                items={finishedTasks}
                getKey={(task) => task.id}
              >
                {(task) => (
                  <TaskRow task={task} onOpenTask={onOpenTask} titleLevel={3} />
                )}
              </AnimatedList>
              {finished.moreFailed ? (
                <ErrorState
                  text="Nu am putut încărca mai multe taskuri."
                  onRetry={finished.loadMore}
                />
              ) : (
                finished.hasMore && (
                  // The end of the list: coming into view, it asks for the
                  // next page; the button does the same for a keyboard.
                  <div ref={sentinel} className="flex justify-center pt-2">
                    <Button
                      variant="outline"
                      disabled={finished.isLoadingMore}
                      onClick={finished.loadMore}
                    >
                      {finished.isLoadingMore
                        ? 'Se încarcă…'
                        : 'Încarcă mai multe'}
                    </Button>
                  </div>
                )
              )}
            </Panel>
          )}
          {nothing && settled && (
            <EmptyState
              bare
              action={needle ? <ClearSearchButton search={search} /> : null}
            >
              {rows.length + finishedCounts.total === 0
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
