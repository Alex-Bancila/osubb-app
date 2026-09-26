import { useEffect, useId, useMemo, useState } from 'react';
import { Empty, EmptyHeader, EmptyTitle } from '../../components/ui/empty';
import { formatTaskCount } from '../../lib/format';
import { useWorkFilter } from '../../lib/use-work-filter';
import { matchesWorkFilter } from '../../lib/work-filter';
import { RANGE_FIRST, TrackerWorkFilter } from './TrackerWorkFilter';
import { TaskRow } from './TaskRow';
import {
  compareManagedTasks,
  MANAGER_TASK_STATES,
  matchesTaskState,
  searchableTitle,
  type ManagerTaskSort,
} from './manager-task-list';
import {
  toTaskPresentation,
  type TaskPresentationRow,
} from './task-presentation';

const SEARCH_DELAY_MS = 200;

const control =
  'min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring';

/**
 * De gestionat and Toate (#687): the Work Filter, then Stare, the title
 * search and the order, then the Tasks as dense rows — no table, so nothing
 * scrolls sideways at any width.
 */
export function ManagerTaskList({
  rows,
  now,
  onOpenTask,
}: {
  rows: readonly TaskPresentationRow[];
  now: Date;
  onOpenTask?: (id: number) => void;
}) {
  const id = useId();
  const { params } = useWorkFilter();
  const [state, setState] = useState('');
  const [search, setSearch] = useState('');
  const [needle, setNeedle] = useState('');
  const [sort, setSort] = useState<ManagerTaskSort>('deadline');
  useEffect(() => {
    const timer = window.setTimeout(
      () => setNeedle(searchableTitle(search.trim())),
      SEARCH_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [search]);

  const tasks = useMemo(
    () =>
      params
        ? rows
            .filter((row) => matchesWorkFilter(row, params))
            .map((row) => toTaskPresentation(row, now))
            .filter(
              (task) =>
                matchesTaskState(task, state) &&
                (!needle || searchableTitle(task.title).includes(needle)),
            )
            .sort(compareManagedTasks(sort))
        : [],
    [rows, params, now, state, needle, sort],
  );

  return (
    <div className="min-w-0 space-y-4">
      <TrackerWorkFilter hint="Grupul include toate subgrupurile sale; perioada se aplică termenului taskului." />
      <div className="grid min-w-0 gap-3 sm:grid-cols-3">
        <label className="grid min-w-0 gap-1 text-sm" htmlFor={`${id}-state`}>
          Stare
          <select
            id={`${id}-state`}
            className={control}
            value={state}
            onChange={(event) => setState(event.target.value)}
          >
            <option value="">Toate stările</option>
            {MANAGER_TASK_STATES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-0 gap-1 text-sm" htmlFor={`${id}-search`}>
          Caută după titlu
          <input
            id={`${id}-search`}
            type="search"
            className={control}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label className="grid min-w-0 gap-1 text-sm" htmlFor={`${id}-sort`}>
          Ordonează după
          <select
            id={`${id}-sort`}
            className={control}
            value={sort}
            onChange={(event) => setSort(event.target.value as ManagerTaskSort)}
          >
            <option value="deadline">Termen</option>
            <option value="title">Titlu</option>
          </select>
        </label>
      </div>
      {!params ? (
        <p>{RANGE_FIRST}</p>
      ) : (
        <section aria-label="Lista taskurilor" className="min-w-0 space-y-2">
          <p
            role="status"
            className="text-sm text-muted-foreground tabular-nums"
          >
            {tasks.length
              ? formatTaskCount(tasks.length)
              : `${formatTaskCount(0)} — niciun task nu corespunde filtrelor.`}
          </p>
          {tasks.length ? (
            <ul data-slot="task-row-list" className="grid min-w-0 gap-2 p-0">
              {tasks.map((task) => (
                <li key={task.id} className="min-w-0">
                  <TaskRow task={task} onOpenTask={onOpenTask} />
                </li>
              ))}
            </ul>
          ) : (
            <Empty className="border border-dashed border-border">
              <EmptyHeader>
                <EmptyTitle>Niciun task nu corespunde filtrelor.</EmptyTitle>
              </EmptyHeader>
            </Empty>
          )}
        </section>
      )}
    </div>
  );
}
