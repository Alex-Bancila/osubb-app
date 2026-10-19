import { useMemo, useState, type ReactNode, type Ref } from 'react';
import { ListChecks } from 'lucide-react';
import { SubHeading, rowListClass } from '../../../components/layout';
import { Button } from '../../../components/ui/button';
import { formatPointCount } from '../../../lib/format';
import type { RoleEvaluationKind } from '../../../lib/schemas/role-evaluation';
import { useMemberIdentities } from '../../../queries/member-identities';
import {
  simulationOutcome,
  useRetentionSignals,
  type RankingRow,
} from '../../../queries/role-evaluations';
import {
  countsText,
  lineText,
  roleLabel,
  signalReasonText,
  UNIVERSITY_SIGNALS_NOTE,
} from './portofoliu-text';
import { RankingSheet } from './RankingSheet';
import { Name } from './shared';

/** One Member of a list of the card: their name, then what is said about them. */
function Entry({ children, detail }: { children: ReactNode; detail: string }) {
  return (
    <li className="grid min-w-0 gap-0.5 py-2 first:pt-0 last:pb-0">
      {children}
      <span className="text-sm text-muted-foreground tabular-nums">
        {detail}
      </span>
    </li>
  );
}

/**
 * What a Simulation found (R58): the line, how many Members were ranked among
 * those evaluated, who would become a Promotion Candidate and who a Retention
 * Signal, and the whole ranking in a sheet. Nothing here was saved. The rows
 * cannot show the Signals about Universitate — they are live, not a result of
 * a run — so the card says so and, for the Adunarea Generală, lists the open
 * ones beside the Signals the run would raise.
 */
export function SimulationResult({
  kind,
  floor,
  rows,
  lineRef,
}: {
  kind: RoleEvaluationKind;
  /** The Prag minim the Simulation used: what a Member under it is judged by. */
  floor: number;
  rows: readonly RankingRow[];
  /** Where focus goes when the result replaces the form that asked for it. */
  lineRef?: Ref<HTMLParagraphElement>;
}) {
  const [ranking, setRanking] = useState(false);
  const outcome = useMemo(() => simulationOutcome(rows, kind), [rows, kind]);
  // Voters who left UBB are Signals of the Adunarea Generală kind.
  const stored = useRetentionSignals().data;
  const university = useMemo(
    () =>
      kind === 'adunarea_generala'
        ? (stored ?? []).filter(
            (signal) =>
              signal.kind === 'adunarea_generala' &&
              signal.reason === 'not_ubb_student',
          )
        : [],
    [stored, kind],
  );
  const identities = useMemberIdentities([
    ...outcome.candidates.map((row) => row.memberId),
    ...outcome.signals.map(({ row }) => row.memberId),
    ...university.map((signal) => signal.memberId),
  ]).data;
  const signalCount = outcome.signals.length + university.length;
  return (
    <div data-slot="simulation-result" className="grid min-w-0 gap-4">
      <div className="grid gap-0.5">
        <p
          ref={lineRef}
          tabIndex={-1}
          data-slot="simulation-line"
          className="m-0 text-base font-semibold tabular-nums outline-none"
        >
          {lineText(kind, outcome.line)}
        </p>
        <p className="m-0 text-sm text-muted-foreground tabular-nums">
          {countsText(outcome.rankedCount, outcome.evaluatedCount)}
        </p>
      </div>

      <div className="grid min-w-0 gap-1">
        <SubHeading>Candidați la promovare</SubHeading>
        {kind === 'adunarea_generala' ? (
          <p className="m-0 text-sm text-muted-foreground">
            Adunarea Generală nu are candidați la promovare.
          </p>
        ) : outcome.candidates.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">
            Niciun candidat la promovare.
          </p>
        ) : (
          <ul className={rowListClass} aria-label="Candidați la promovare">
            {outcome.candidates.map((row) => (
              <Entry
                key={row.memberId}
                detail={formatPointCount(row.taskPoints)}
              >
                <Name memberId={row.memberId} identities={identities} />
              </Entry>
            ))}
          </ul>
        )}
      </div>

      <div className="grid min-w-0 gap-1">
        <SubHeading>Semnale de retenție</SubHeading>
        {signalCount === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">
            Niciun semnal de retenție în simulare.
          </p>
        ) : (
          <ul
            className={rowListClass}
            aria-label="Semnale de retenție din simulare"
          >
            {outcome.signals.map(({ row, reason }) => (
              <Entry
                key={`${row.memberId}:${reason}`}
                detail={`${roleLabel(row.role)} · ${signalReasonText({
                  kind,
                  reason,
                  taskPoints: row.taskPoints,
                  thresholdUsed: reason === 'below_floor' ? floor : row.line,
                })}`}
              >
                <Name memberId={row.memberId} identities={identities} />
              </Entry>
            ))}
            {university.map((signal) => (
              <Entry
                key={`${signal.memberId}:${signal.reason}`}
                detail={`${roleLabel(signal.roleAtListing)} · ${signalReasonText(signal)}`}
              >
                <Name memberId={signal.memberId} identities={identities} />
              </Entry>
            ))}
          </ul>
        )}
        <p className="m-0 text-sm text-muted-foreground">
          {UNIVERSITY_SIGNALS_NOTE}
        </p>
      </div>

      <Button
        type="button"
        variant="outline"
        className="justify-self-start"
        onClick={() => setRanking(true)}
      >
        <ListChecks aria-hidden="true" />
        Vezi clasamentul
      </Button>
      <RankingSheet
        open={ranking}
        onOpenChange={setRanking}
        title="Clasamentul simulării"
        kind={kind}
        rows={rows}
      />
    </div>
  );
}
