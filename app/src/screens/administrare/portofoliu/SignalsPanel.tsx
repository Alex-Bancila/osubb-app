import { useMemo } from 'react';
import { Link } from 'react-router';
import { cn } from 'cn';
import {
  EmptyState,
  ListRow,
  Panel,
  rowListClass,
  SubHeading,
} from '../../../components/layout';
import { ErrorState, Loading } from '../../../components/states';
import { buttonVariants } from '../../../components/ui/button';
import { InfoHint } from '../../../components/ui/info-hint';
import { useMemberIdentities } from '../../../queries/member-identities';
import {
  useRetentionSignals,
  type RetentionSignal,
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

/** The open Signals of each kind, kinds in the order the read gives them. */
function byKind(signals: readonly RetentionSignal[]) {
  const groups = new Map<string, RetentionSignal[]>();
  for (const signal of signals)
    groups.set(signal.kind, [...(groups.get(signal.kind) ?? []), signal]);
  return [...groups];
}

/**
 * Semnale de retenție (R58): the stored, open Signals — a holder a finalised
 * run found below the line or the Prag minim, and a voter whose Universitate
 * is not UBB — each with its reason, the day it was raised and a way to
 * Roluri. Retiring a Role is BC's decision there; a Signal closes by itself
 * when the Role changes, the fact reverses or the kind's next run replaces it.
 */
export function SignalsPanel() {
  const signals = useRetentionSignals();
  const groups = useMemo(() => byKind(signals.data ?? []), [signals.data]);
  const identities = useMemberIdentities(
    (signals.data ?? []).map((signal) => signal.memberId),
  );
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
      stack={4}
    >
      {signals.isPending ? (
        <Loading label="Se încarcă semnalele…" />
      ) : signals.isError ? (
        <ErrorState
          text="Nu am putut încărca semnalele de retenție."
          onRetry={() => void signals.refetch()}
        />
      ) : groups.length === 0 ? (
        <EmptyState>Niciun semnal de retenție deschis.</EmptyState>
      ) : (
        groups.map(([kind, rows]) => (
          <div key={kind} className="grid min-w-0 gap-1">
            <SubHeading>{KIND_LABEL[kind] ?? kind}</SubHeading>
            <ul
              className={rowListClass}
              aria-label={`Semnale de retenție: ${KIND_LABEL[kind] ?? kind}`}
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
                    <Name
                      memberId={signal.memberId}
                      identities={identities.data}
                    />
                    <p className="m-0 text-sm text-muted-foreground tabular-nums">
                      {roleLabel(signal.roleAtListing)} ·{' '}
                      {signalReasonText(signal)} ·{' '}
                      {formatInstantDay(signal.listedAt)}
                    </p>
                  </ListRow>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </Panel>
  );
}
