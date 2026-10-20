import { useMemo, useState } from 'react';
import {
  DataTable,
  type DataTableColumn,
} from '../../../components/data-table/DataTable';
import { Panel, rowListClass } from '../../../components/layout';
import { Button } from '../../../components/ui/button';
import { formatDay } from '../../../lib/format';
import { useMemberIdentities } from '../../../queries/member-identities';
import type { RoleEvaluation } from '../../../queries/role-evaluations';
import { useMinWidth } from '../../volunteers/use-min-width';
import type { RoleEvaluationKind } from '../../../lib/schemas/role-evaluation';
import {
  formatInstantDay,
  pointsOrDash,
  rangeText,
  THRESHOLD_LABEL,
} from './portofoliu-text';
import { RunRankingSheet } from './RankingSheet';
import { Name, type Identities } from './shared';

/** A run's Procent, or `—` for a run recorded before Portofoliu Interne. */
function percentOrDash(run: RoleEvaluation) {
  return run.percent_used === null ? '—' : `${run.percent_used} %`;
}

/** How many Members the run ranked among those it evaluated. */
function countsOrDash(run: RoleEvaluation) {
  return run.evaluated_count === null
    ? '—'
    : `${run.ranked_count} / ${run.evaluated_count}`;
}

function historyColumns(
  kind: RoleEvaluationKind,
  identities: Identities,
  open: (run: RoleEvaluation) => void,
): DataTableColumn<RoleEvaluation>[] {
  const plain = { enableSorting: false } as const;
  const columns: DataTableColumn<RoleEvaluation>[] = [
    {
      id: 'name',
      accessorFn: (row) => row.name,
      header: 'Nume',
      ...plain,
      cell: ({ row }) => (
        <span className="font-medium">{row.original.name}</span>
      ),
    },
    {
      id: 'range',
      accessorFn: (row) => rangeText(row),
      header: 'Interval',
      ...plain,
    },
    {
      id: 'floor',
      accessorFn: (row) => row.eligibility_floor,
      header: 'Prag minim',
      ...plain,
      cell: ({ row }) => pointsOrDash(row.original.eligibility_floor),
    },
    {
      id: 'percent',
      accessorFn: (row) => row.percent_used,
      header: 'Procent',
      ...plain,
      cell: ({ row }) => percentOrDash(row.original),
    },
    {
      id: 'cutoff',
      accessorFn: (row) => row.membership_cutoff,
      header: 'Data limită de intrare',
      ...plain,
      cell: ({ row }) => formatDay(row.original.membership_cutoff),
    },
    {
      id: 'run_by',
      accessorFn: (row) => row.run_by,
      header: 'Rulată de',
      ...plain,
      cell: ({ row }) => (
        <Name memberId={row.original.run_by} identities={identities} />
      ),
    },
    {
      id: 'run_at',
      accessorFn: (row) => row.run_at,
      header: 'Data',
      ...plain,
      cell: ({ row }) => formatInstantDay(row.original.run_at),
    },
    {
      // The line in force before the run: a first run had none. It is the
      // line of the kind the page shows.
      id: 'threshold_used',
      accessorFn: (row) => row.threshold_used,
      header: 'Linia înainte',
      ...plain,
      cell: ({ row }) => pointsOrDash(row.original.threshold_used),
    },
    {
      // The line the run computed: none when nobody reached the Prag minim.
      id: 'threshold_computed',
      accessorFn: (row) => row.threshold_computed,
      header: 'Linia calculată',
      ...plain,
      cell: ({ row }) => pointsOrDash(row.original.threshold_computed),
    },
    {
      id: 'counts',
      accessorFn: (row) => row.ranked_count,
      header: 'Clasați / evaluați',
      ...plain,
      cell: ({ row }) => countsOrDash(row.original),
    },
    {
      id: 'ranking',
      accessorFn: (row) => row.id,
      header: 'Clasament',
      ...plain,
      cell: ({ row }) => (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Clasamentul evaluării „${row.original.name}”`}
          onClick={() => open(row.original)}
        >
          Deschide
        </Button>
      ),
    },
  ];
  // The Adunarea Generală has no cutoff: a column of dashes says nothing.
  return kind === 'voluntar_activ'
    ? columns
    : columns.filter((column) => column.id !== 'cutoff');
}

/**
 * The viewport from which the history is a table (Tailwind's `2xl`): its
 * twelve columns need about 1 400 px, which the page has beside the sidebar
 * only from 1 536 px. Under it each run is a list row, so nothing scrolls
 * sideways.
 */
const HISTORY_TABLE_FROM = '96rem';

/**
 * Istoricul evaluărilor: every finalised run of one kind with the values it
 * ranked by (period, Prag minim, Procent, Data limită de intrare), the line in
 * force before it and the line it computed, and how many Members it ranked. A
 * row opens the ranking of that run. The other kind's runs are in the other
 * kind's view.
 */
export function HistoryPanel({
  kind,
  evaluations,
}: {
  kind: RoleEvaluationKind;
  evaluations: readonly RoleEvaluation[];
}) {
  const rows = useMemo(
    () => evaluations.filter((run) => run.kind === kind),
    [evaluations, kind],
  );
  const identities = useMemberIdentities(rows.map((run) => run.run_by));
  const [opened, setOpened] = useState<RoleEvaluation | null>(null);
  const columns = useMemo(
    () => historyColumns(kind, identities.data, setOpened),
    [kind, identities.data],
  );
  const table = useMinWidth(HISTORY_TABLE_FROM);
  return (
    <Panel title="Istoricul evaluărilor">
      {/* Mounted only once a run of the kind exists (B58). */}
      {table ? (
        <DataTable
          columns={columns}
          data={rows}
          emptyTitle="Nicio evaluare încă."
          // A name keeps at least a word at 375 px (F-22).
          columnClassName={{ run_by: 'min-w-36' }}
        />
      ) : (
        <ul className={rowListClass} aria-label="Istoricul evaluărilor">
          {rows.map((run) => (
            <li
              key={run.id}
              className="grid min-w-0 gap-0.5 py-2 text-sm first:pt-0 last:pb-0"
            >
              <span className="font-semibold wrap-anywhere">{run.name}</span>
              <span className="text-muted-foreground tabular-nums">
                {rangeText(run)}
              </span>
              <span className="text-muted-foreground tabular-nums">
                Prag minim {pointsOrDash(run.eligibility_floor)} · Procent{' '}
                {percentOrDash(run)}
                {run.membership_cutoff &&
                  ` · Data limită de intrare ${formatDay(run.membership_cutoff)}`}
              </span>
              <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-muted-foreground">
                <span>Rulată de</span>
                <Name memberId={run.run_by} identities={identities.data} />
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">
                  {formatInstantDay(run.run_at)}
                </span>
              </span>
              <span className="text-muted-foreground tabular-nums">
                {THRESHOLD_LABEL[kind]} înainte{' '}
                {pointsOrDash(run.threshold_used)} · calculat{' '}
                {pointsOrDash(run.threshold_computed)} · {countsOrDash(run)}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-1 justify-self-start"
                aria-label={`Clasamentul evaluării „${run.name}”`}
                onClick={() => setOpened(run)}
              >
                Deschide
              </Button>
            </li>
          ))}
        </ul>
      )}
      <RunRankingSheet run={opened} onClose={() => setOpened(null)} />
    </Panel>
  );
}
