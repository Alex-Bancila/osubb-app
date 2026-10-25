import { useMemo, useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import {
  DataTable,
  type DataTableColumn,
} from '../../../components/data-table/DataTable';
import { EmptyState } from '../../../components/layout';
import { ErrorState, Loading } from '../../../components/states';
import {
  Sheet,
  SheetBackdrop,
  SheetDescription,
  SheetHeader,
  SheetPopup,
  SheetPortal,
  SheetTitle,
} from '../../../components/ui/sheet';
import { formatPoints } from '../../../lib/format';
import type { RoleEvaluationKind } from '../../../lib/schemas/role-evaluation';
import { useMemberIdentities } from '../../../queries/member-identities';
import {
  useRoleEvaluationRanking,
  type RankingRow,
  type RoleEvaluation,
} from '../../../queries/role-evaluations';
import {
  countsText,
  lineText,
  roleLabel,
  votersOnlyText,
} from './portofoliu-text';
import { Name, type Identities } from './shared';

/**
 * The rows a kind's sheet lists. Both kinds rank everyone below BCE, but the
 * Adunarea Generală run judges the voters alone, so its sheet lists them
 * alone (Alex, 2026-10-25); each keeps their place in the whole ranking, the
 * one the line is read from, so the places may skip.
 */
function listedRows(
  kind: RoleEvaluationKind | undefined,
  rows: readonly RankingRow[],
): readonly RankingRow[] {
  return kind === 'adunarea_generala'
    ? rows.filter((row) => row.role === 'vot')
    : rows;
}

function columns(
  identities: Identities,
  withRole: boolean,
): DataTableColumn<RankingRow>[] {
  return [
    {
      id: 'member',
      accessorFn: (row) => row.memberId,
      header: 'Membru',
      enableSorting: false,
      cell: ({ row }) => (
        <Name memberId={row.original.memberId} identities={identities} />
      ),
    },
    // Every row of a voters-only sheet would say the same Role.
    ...(withRole
      ? [
          {
            id: 'role',
            accessorFn: (row: RankingRow) => roleLabel(row.role),
            header: 'Rol',
            enableSorting: false,
          },
        ]
      : []),
    {
      id: 'points',
      accessorFn: (row) => row.taskPoints,
      header: 'Puncte',
      enableSorting: false,
      cell: ({ row }) => (
        <span className="tabular-nums">
          {formatPoints(row.original.taskPoints)}
        </span>
      ),
    },
    {
      // A Member under the Prag minim is not ranked: no place to name.
      id: 'rank',
      accessorFn: (row) => row.rank,
      header: 'Loc',
      enableSorting: false,
      cell: ({ row }) =>
        row.original.rank === null ? (
          <span className="text-muted-foreground">sub prag minim</span>
        ) : (
          <span className="tabular-nums">{row.original.rank}</span>
        ),
    },
    {
      id: 'inside',
      accessorFn: (row) => row.inside,
      header: 'Atinge linia',
      enableSorting: false,
      cell: ({ row }) =>
        row.original.inside ? (
          <>
            <Check aria-hidden="true" className="size-4 text-primary" />
            <span className="sr-only">Da</span>
          </>
        ) : (
          <span className="sr-only">Nu</span>
        ),
    },
  ];
}

/** The rows listed, in the order the read returns them. */
function RankingTable({
  rows,
  votersOnly,
}: {
  rows: readonly RankingRow[];
  votersOnly: boolean;
}) {
  const identities = useMemberIdentities(rows.map((row) => row.memberId));
  const table = useMemo(
    () => columns(identities.data, !votersOnly),
    [identities.data, votersOnly],
  );
  const data = useMemo(() => [...rows], [rows]);
  return (
    <DataTable
      columns={table}
      data={data}
      emptyTitle={
        votersOnly
          ? 'Niciun Voluntar cu Drept de Vot nu a fost evaluat.'
          : 'Nimeni nu a fost evaluat.'
      }
    />
  );
}

/**
 * One sheet for the whole ranking of a Simulation and of a finished run
 * (R58): every Member evaluated — for the Adunarea Generală, every voter
 * evaluated — in the order the read gives, with their Role, their points,
 * their place in the whole ranking — or `sub prag minim` when they did not
 * reach the Prag minim and so did not shape the percentile — and whether they
 * fall inside the line. The summary always counts everyone ranked and
 * evaluated, the figures the line comes from. Children replace the table
 * while it loads, fails or has nothing to show.
 */
export function RankingSheet({
  open,
  onOpenChange,
  title,
  kind,
  line,
  rows,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Names the line in the summary; the rows alone do not say which kind. */
  kind?: RoleEvaluationKind;
  /**
   * The line the summary states, when it is not the rows': a finished run
   * states the one it recorded, while its rows are recomputed from today's
   * ledger (spec C) and a later reversal may have moved theirs.
   */
  line?: number | null;
  rows?: readonly RankingRow[];
  children?: ReactNode;
}) {
  const first = rows?.[0];
  const votersOnly = kind === 'adunarea_generala';
  const listed = listedRows(kind, rows ?? []);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetPortal>
        <SheetBackdrop />
        <SheetPopup side="bottom" className="gap-4 p-4 sm:max-w-3xl sm:p-6">
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            {first && kind ? (
              <SheetDescription className="tabular-nums">
                {lineText(kind, line === undefined ? first.line : line)} ·{' '}
                {countsText(first.rankedCount, first.evaluatedCount)}
              </SheetDescription>
            ) : (
              <SheetDescription className="sr-only">
                Clasamentul tuturor membrilor evaluați.
              </SheetDescription>
            )}
            {first && votersOnly ? (
              <p className="m-0 text-sm text-muted-foreground">
                {votersOnlyText(listed.length)}
              </p>
            ) : null}
          </SheetHeader>
          {children ?? <RankingTable rows={listed} votersOnly={votersOnly} />}
        </SheetPopup>
      </SheetPortal>
    </Sheet>
  );
}

/**
 * The sheet of a finished run: its ranking is recomputed by the server from
 * the values the run recorded. A run recorded before Portofoliu Interne kept
 * none of them, so it has no ranking to recompute and the sheet says so.
 */
export function RunRankingSheet({
  run,
  onClose,
}: {
  run: RoleEvaluation | null;
  onClose: () => void;
}) {
  // The sheet stays mounted so it slides out; while it closes it keeps
  // showing the run it held.
  const [held, setHeld] = useState(run);
  if (run && held?.id !== run.id) setHeld(run);
  const shown = run ?? held;
  const readable = shown !== null && shown.eligibility_floor !== null;
  const ranking = useRoleEvaluationRanking(readable ? shown.id : null);
  const kind = (shown?.kind ?? 'voluntar_activ') as RoleEvaluationKind;
  return (
    <RankingSheet
      open={run !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={shown ? `Clasamentul evaluării „${shown.name}”` : 'Clasament'}
      kind={kind}
      line={readable ? shown.threshold_computed : undefined}
      rows={readable ? ranking.data : undefined}
    >
      {!shown ? null : !readable ? (
        <EmptyState>
          Clasamentul evaluărilor de dinainte de Portofoliu Interne nu mai este
          disponibil.
        </EmptyState>
      ) : ranking.isPending ? (
        <Loading label="Se încarcă clasamentul…" />
      ) : ranking.isError ? (
        <ErrorState
          error={ranking.error}
          text="Nu am putut încărca clasamentul."
          retryLabel="Reîncarcă clasamentul"
          onRetry={() => void ranking.refetch()}
        />
      ) : undefined}
    </RankingSheet>
  );
}
