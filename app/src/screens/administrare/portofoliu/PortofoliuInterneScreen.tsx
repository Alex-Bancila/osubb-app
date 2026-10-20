import { useState } from 'react';
import { PageGrid } from '../../../components/layout';
import { ErrorState, Loading } from '../../../components/states';
import { SegmentedRadio } from '../../../components/ui/segmented-radio';
import type { RoleEvaluationKind } from '../../../lib/schemas/role-evaluation';
import {
  useEvaluationSettingCommand,
  type EvaluationSettingCommand,
} from '../../../queries/evaluation-settings';
import {
  usePromotionCandidates,
  usePromotionThresholds,
  useRetentionSignals,
  useRoleEvaluationCommand,
  useRoleEvaluations,
  useThresholdChanges,
  type RoleEvaluationCommand,
} from '../../../queries/role-evaluations';
import { ReceiptTurnScope } from '../../tracker/ReceiptTurnScope';
import { CandidatesPanel } from './CandidatesPanel';
import { ChangeLogPanel } from './ChangeLogPanel';
import { HistoryPanel } from './HistoryPanel';
import { KIND_LABEL } from './portofoliu-text';
import { RunPanel } from './RunPanel';
import { SettingsPanel } from './SettingsPanel';
import { SignalsPanel } from './SignalsPanel';

const KINDS: readonly RoleEvaluationKind[] = [
  'voluntar_activ',
  'adunarea_generala',
];

/**
 * Administrare → **Portofoliu Interne** (R58, over Evaluări de rol #827):
 * BC or the Moderator simulates and then finalises a Role Evaluation of one
 * kind, keeps the settings every run and every total reads (Prag minim, Data
 * limită de intrare, Data de început a punctajului, the two Procente, the two
 * Promotion Thresholds), decides the Promotion Candidates (promotion itself
 * stays in the Role panel), reads the Retention Signals, and the history of
 * runs and of changes.
 *
 * One **Tip** switch at the top chooses the kind the run form is of. The
 * settings, the lists and the histories show both kinds, whichever is
 * chosen. Until something exists only the run form and the settings are on
 * the page: each list appears with its first row, the log with its first
 * change (B58). Mounted behind `manageRoles`; every command decides again on
 * the server (level 6).
 */
export default function PortofoliuInterneScreen() {
  const evaluations = useRoleEvaluations();
  const thresholds = usePromotionThresholds();
  // Read here too, so the page decides which lists exist (B58).
  const changes = useThresholdChanges();
  const candidates = usePromotionCandidates();
  const signals = useRetentionSignals();
  const command = useRoleEvaluationCommand();
  const setting = useEvaluationSettingCommand();
  const [kind, setKind] = useState<RoleEvaluationKind>('voluntar_activ');

  if (evaluations.isPending || thresholds.isPending)
    return <Loading label="Se încarcă Portofoliu Interne…" />;
  if (evaluations.isError || thresholds.isError)
    return (
      <ErrorState
        text="Nu am putut încărca Portofoliu Interne."
        onRetry={() => {
          void evaluations.refetch();
          void thresholds.refetch();
        }}
      />
    );
  const busy = command.isPending || setting.isPending;
  const onRun = (next: RoleEvaluationCommand) => command.mutateAsync(next);
  const onSetting = (next: EvaluationSettingCommand) =>
    setting.mutateAsync(next);
  const hasRun = evaluations.data.length > 0;
  // A Candidate or a Signal can exist before any run: between runs they are
  // listed live. A list that failed to load still shows its retry.
  const hasCandidates =
    hasRun || candidates.isError || (candidates.data?.length ?? 0) > 0;
  const hasSignals =
    hasRun || signals.isError || (signals.data?.length ?? 0) > 0;
  const hasLog = changes.isError || (changes.data?.length ?? 0) > 0;
  return (
    <ReceiptTurnScope>
      {/* A choice of two, drawn as segments; a long label wraps inside its
          segment, never past it (F-22). */}
      <SegmentedRadio<RoleEvaluationKind>
        aria-label="Tip"
        className="sm:max-w-xl"
        options={KINDS.map((value) => ({ value, label: KIND_LABEL[value] }))}
        value={kind}
        onValueChange={setKind}
        disabled={busy}
      />
      <PageGrid columns={2} alignHeaders>
        <RunPanel
          kind={kind}
          evaluations={evaluations.data}
          disabled={busy}
          onRun={onRun}
        />
        <SettingsPanel
          thresholds={thresholds.data}
          evaluations={evaluations.data}
          disabled={busy}
          onRun={onRun}
          onSetting={onSetting}
        />
      </PageGrid>
      <PageGrid columns={1}>
        {hasCandidates && <CandidatesPanel disabled={busy} onRun={onRun} />}
        {hasSignals && <SignalsPanel />}
        {hasRun && <HistoryPanel evaluations={evaluations.data} />}
        {hasLog && <ChangeLogPanel evaluations={evaluations.data} />}
      </PageGrid>
    </ReceiptTurnScope>
  );
}
