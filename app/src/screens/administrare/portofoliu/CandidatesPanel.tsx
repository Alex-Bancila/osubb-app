import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { UserCheck } from 'lucide-react';
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
import { formatDay, formatPointCount, formatPoints } from '../../../lib/format';
import { useMemberIdentities } from '../../../queries/member-identities';
import {
  NO_SUBJECTS,
  PROMOTION_CANDIDATES_SUBJECT,
  useReadNotificationsAbout,
} from '../../../queries/notifications';
import { usePromotionCandidates } from '../../../queries/role-evaluations';
import { formatInstantDay, promoteHref, shownName } from './portofoliu-text';
import { Name, RejectDialog, type RunCommand } from './shared';

/**
 * Candidați la promovare: the Voluntari who joined by the Data limită de
 * intrare and reach the Prag de promovare — listed by a run or, between runs,
 * the moment they qualify (#983, R58). Nobody is promoted here: Promovează
 * opens Roluri on the Member, Respinge records BC's reason.
 */
export function CandidatesPanel({
  disabled,
  onRun,
}: {
  disabled: boolean;
  onRun: RunCommand;
}) {
  const candidates = usePromotionCandidates();
  const memberIds = useMemo(
    () => (candidates.data ?? []).map((candidate) => candidate.memberId),
    [candidates.data],
  );
  const identities = useMemberIdentities(memberIds);
  // #1012 (R37): the list shows every Promotion Candidate at once, so every
  // "Candidat la promovare" Notification of the viewer is read.
  useReadNotificationsAbout(
    candidates.data ? [PROMOTION_CANDIDATES_SUBJECT] : NO_SUBJECTS,
  );
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <Panel
      title="Candidați la promovare"
      control={
        <InfoHint label="Despre candidații la promovare">
          Voluntari intrați până la data limită de intrare, care ating pragul de
          promovare: de îndată ce îl ating, și la fiecare evaluare Voluntar
          Activ. Nimeni nu este promovat automat: BC decide în panoul de roluri.
        </InfoHint>
      }
    >
      {notice && (
        <p role="alert" className="m-0 mb-2 text-sm">
          {notice}
        </p>
      )}
      {candidates.isPending ? (
        <Loading label="Se încarcă candidații…" />
      ) : candidates.isError ? (
        <ErrorState
          text="Nu am putut încărca candidații la promovare."
          onRetry={() => void candidates.refetch()}
        />
      ) : candidates.data.length === 0 ? (
        <EmptyState icon={UserCheck}>Niciun candidat la promovare.</EmptyState>
      ) : (
        <ul className={rowListClass} aria-label="Candidați la promovare">
          {candidates.data.map((candidate) => {
            const name = shownName(candidate.memberId, identities.data);
            return (
              <ListRow
                key={candidate.id}
                stackAction
                action={
                  <>
                    <Link
                      to={promoteHref(candidate)}
                      aria-label={`Promovează: ${name}`}
                      // The page's one filled button is the run form's.
                      className={cn(buttonVariants({ variant: 'outline' }))}
                    >
                      Promovează
                    </Link>
                    <RejectDialog
                      candidate={candidate}
                      name={name}
                      disabled={disabled}
                      onRun={onRun}
                      onStale={setNotice}
                      identities={identities.data}
                    />
                  </>
                }
              >
                <Name
                  memberId={candidate.memberId}
                  identities={identities.data}
                />
                <p className="m-0 text-sm tabular-nums">
                  {formatPointCount(candidate.taskPoints)} · pragul de promovare{' '}
                  {formatPoints(candidate.thresholdUsed)} · în OSUBB din{' '}
                  {formatDay(candidate.tenureSince)}
                </p>
                <p className="m-0 text-sm text-muted-foreground">
                  {candidate.evaluationName === null
                    ? `Eligibil din ${formatInstantDay(candidate.listedAt)}, între evaluări`
                    : `Evaluarea „${candidate.evaluationName}”`}
                </p>
              </ListRow>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
