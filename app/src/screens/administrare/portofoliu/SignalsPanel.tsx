import { useMemo } from 'react';
import { Link } from 'react-router';
import { cn } from 'cn';
import {
  EmptyState,
  ListRow,
  Panel,
  rowListClass,
} from '../../../components/layout';
import { ErrorState, Loading } from '../../../components/states';
import { buttonVariants } from '../../../components/ui/button';
import { InfoHint } from '../../../components/ui/info-hint';
import type { RoleEvaluationKind } from '../../../lib/schemas/role-evaluation';
import { useMemberIdentities } from '../../../queries/member-identities';
import {
  useRetentionSignals,
  type RetentionSignal,
  type RoleEvaluation,
} from '../../../queries/role-evaluations';
import { ROLE_PANEL_MEMBER_PARAM } from '../RolePanel';
import {
  formatInstantDay,
  KIND_LABEL,
  roleLabel,
  shownName,
  signalReasonText,
} from './portofoliu-text';
import { Name } from './shared';

/**
 * Semnale de retenție (R58): the stored, open Signals of one kind — a holder
 * a finalised run found below the line or the Prag minim, and a voter whose
 * Universitate is not UBB — each with its reason, the day it was raised and a
 * way to Roluri. Retiring a Role is BC's decision there; a Signal closes by
 * itself when the Role changes, the fact reverses or the kind's next run
 * replaces it. The other kind's Signals are in the other kind's view.
 */
export function SignalsPanel({
  kind,
  evaluations,
}: {
  kind: RoleEvaluationKind;
  evaluations: readonly RoleEvaluation[];
}) {
  const signals = useRetentionSignals();
  const rows = useMemo(
    () => (signals.data ?? []).filter((signal) => signal.kind === kind),
    [signals.data, kind],
  );
  const identities = useMemberIdentities(rows.map((signal) => signal.memberId));
  // A Member under the Floor is judged by it: the run's Prag minim, not the
  // line the Signal stores.
  const reason = (signal: RetentionSignal) =>
    signalReasonText({
      kind: signal.kind,
      reason: signal.reason,
      taskPoints: signal.taskPoints,
      thresholdUsed:
        signal.reason === 'below_floor'
          ? (evaluations.find((run) => run.id === signal.roleEvaluationId)
              ?.eligibility_floor ?? null)
          : signal.thresholdUsed,
    });
  return (
    <Panel
      title="Semnale de retenție"
      control={
        <InfoHint label="Despre semnalele de retenție">
          Deținători ai rolului găsiți de o evaluare sub linia evaluării sale
          (pragul de promovare sau pragul Adunării Generale) sau sub pragul
          minim, și votanți care nu mai sunt studenți UBB. Retragerea unui rol
          este decizia BC, din panoul de roluri.
        </InfoHint>
      }
    >
      {signals.isPending ? (
        <Loading label="Se încarcă semnalele…" />
      ) : signals.isError ? (
        <ErrorState
          text="Nu am putut încărca semnalele de retenție."
          onRetry={() => void signals.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState>Niciun semnal de retenție deschis.</EmptyState>
      ) : (
        <ul
          className={rowListClass}
          aria-label={`Semnale de retenție: ${KIND_LABEL[kind]}`}
        >
          {rows.map((signal) => {
            const name = shownName(signal.memberId, identities.data);
            return (
              <ListRow
                key={signal.id}
                stackAction
                action={
                  <Link
                    to={`/administrare/roluri?${ROLE_PANEL_MEMBER_PARAM}=${encodeURIComponent(signal.memberId)}`}
                    aria-label={`Editează rolul: ${name}`}
                    className={cn(buttonVariants({ variant: 'outline' }))}
                  >
                    Editează rolul
                  </Link>
                }
              >
                <Name memberId={signal.memberId} identities={identities.data} />
                <p className="m-0 text-sm text-muted-foreground tabular-nums">
                  {roleLabel(signal.roleAtListing)} · {reason(signal)} ·{' '}
                  {formatInstantDay(signal.listedAt)}
                </p>
              </ListRow>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
