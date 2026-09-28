import { useEffect, useMemo, useState } from 'react';
import { EmptyState } from '../../components/layout';
import {
  NativeSelect,
  NativeSelectOption,
} from '../../components/ui/native-select';
import {
  workFilterCellClass,
  workFilterFieldClass,
} from '../../components/work-filter/field-class';
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

/**
 * Stare, Caută and Ordonează appear from this many Tasks up: below it the
 * whole list fits on one screen (relevance B18).
 */
export const LIST_CONTROLS_FROM = 6;

/**
 * De gestionat and Toate (#687): one Filtre panel — the Work Filter, then,
 * on the same grid, Stare (only the states the list holds), the title search
 * and the order (#845, layout T4) — then the Tasks as dense rows, no table,
 * so nothing scrolls sideways at any width.
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
  const { params } = useWorkFilter();
  const [chosenState, setState] = useState('');
  const [search, setSearch] = useState('');
  const [needle, setNeedle] = useState('');
  const [chosenSort, setSort] = useState<ManagerTaskSort>('deadline');
  useEffect(() => {
    const timer = window.setTimeout(
      () => setNeedle(searchableTitle(search.trim())),
      SEARCH_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [search]);

  const listControls = rows.length >= LIST_CONTROLS_FROM;
  const state = listControls ? chosenState : '';
  const sort = listControls ? chosenSort : 'deadline';
  const query = listControls ? needle : '';

  const presented = useMemo(
    () => rows.map((row) => ({ row, task: toTaskPresentation(row, now) })),
    [rows, now],
  );
  // Stare offers the states the list holds, and the one already chosen.
  const states = useMemo(
    () =>
      MANAGER_TASK_STATES.filter(
        ([value]) =>
          value === state ||
          presented.some(({ task }) => matchesTaskState(task, value)),
      ),
    [presented, state],
  );

  const tasks = useMemo(
    () =>
      params
        ? presented
            .filter(
              ({ row, task }) =>
                matchesWorkFilter(row, params) &&
                matchesTaskState(task, state) &&
                (!query || searchableTitle(task.title).includes(query)),
            )
            .map(({ task }) => task)
            .sort(compareManagedTasks(sort))
        : [],
    [presented, params, state, query, sort],
  );

  const fields = listControls
    ? (id: string) => (
        <>
          <label className={workFilterCellClass} htmlFor={`${id}-state`}>
            <span className="text-sm font-medium">Stare</span>
            <NativeSelect
              id={`${id}-state`}
              value={state}
              onChange={(event) => setState(event.target.value)}
            >
              <NativeSelectOption value="">Toate stările</NativeSelectOption>
              {states.map(([value, label]) => (
                <NativeSelectOption key={value} value={value}>
                  {label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label className={workFilterCellClass} htmlFor={`${id}-search`}>
            <span className="text-sm font-medium">Caută după titlu</span>
            <input
              id={`${id}-search`}
              type="search"
              className={workFilterFieldClass}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label className={workFilterCellClass} htmlFor={`${id}-sort`}>
            <span className="text-sm font-medium">Ordonează după</span>
            <NativeSelect
              id={`${id}-sort`}
              value={sort}
              onChange={(event) =>
                setSort(event.target.value as ManagerTaskSort)
              }
            >
              <NativeSelectOption value="deadline">Termen</NativeSelectOption>
              <NativeSelectOption value="title">Titlu</NativeSelectOption>
            </NativeSelect>
          </label>
        </>
      )
    : undefined;

  return (
    <div className="min-w-0 space-y-4">
      <TrackerWorkFilter
        rows={rows}
        hint="Grupul include toate subgrupurile sale; perioada se aplică termenului taskului."
        fields={fields}
        fieldsActive={Number(Boolean(state)) + Number(Boolean(query))}
      />
      {!params ? (
        <p>{RANGE_FIRST}</p>
      ) : (
        <section aria-label="Lista taskurilor" className="min-w-0 space-y-2">
          {tasks.length ? (
            <>
              <p
                role="status"
                className="text-sm text-muted-foreground tabular-nums"
              >
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
            <EmptyState bare>Niciun task nu corespunde filtrelor.</EmptyState>
          )}
        </section>
      )}
    </div>
  );
}
