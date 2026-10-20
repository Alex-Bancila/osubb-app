import { PageGrid } from '../../../components/layout';
import { ErrorState, Loading } from '../../../components/states';
import {
  SegmentedRadio,
  type SegmentedRadioOption,
} from '../../../components/ui/segmented-radio';
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
import { usePortofoliuView, type PortofoliuView } from './portofoliu-view';
import { RunPanel } from './RunPanel';
import { useRunDrafts } from './run-draft';
import { SettingsPanel } from './SettingsPanel';
import { SignalsPanel } from './SignalsPanel';

const VIEWS: readonly SegmentedRadioOption<PortofoliuView>[] = [
  { value: 'voluntar_activ', label: KIND_LABEL['voluntar_activ'] },
  { value: 'adunarea_generala', label: KIND_LABEL['adunarea_generala'] },
  { value: 'setari', label: 'Setări' },
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
 * One **Secțiune** switch at the top chooses among three views, kept in the
 * URL (`?vedere=`, Alex 2026-10-20): **Voluntar Activ** and **Adunarea
 * Generală**, each with the run form of its kind and its own Candidates,
 * Signals and runs, and **Setări**, with every setting and the log of their
 * changes. The Prag minim and the Data limită de intrare are edited only
 * there; a run uses the ones in force. Until something exists a kind's view is
 * only its run form: each list appears with its first row of that kind, the
 * log with its first change (B58). Mounted behind `manageRoles`; every command
 * decides again on the server (level 6).
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
  const [view, chooseView] = usePortofoliuView();
  // Each kind's run form is kept here, so a visit to Setări (the gate's link
  // included) finds it as it was left, a shown Simulation too.
  const draftOf = useRunDrafts();

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
  // What exists decides which lists appear (B58). A Candidate or a Signal can
  // exist before any run: between runs they are listed live. A list that
  // failed to load still shows its retry.
  const hasRun = (kind: RoleEvaluationKind) =>
    evaluations.data.some((run) => run.kind === kind);
  const hasSignals = (kind: RoleEvaluationKind) =>
    hasRun(kind) ||
    signals.isError ||
    (signals.data ?? []).some((signal) => signal.kind === kind);
  // Only Voluntar Activ has Candidates: a run of the other kind lists none.
  const hasCandidates =
    hasRun('voluntar_activ') ||
    candidates.isError ||
    (candidates.data?.length ?? 0) > 0;
  const hasLog = changes.isError || (changes.data?.length ?? 0) > 0;
  return (
    <ReceiptTurnScope>
      {/* A choice of three, drawn as segments; a long label wraps inside its
          segment, never past it (F-22). */}
      <SegmentedRadio<PortofoliuView>
        aria-label="Secțiune"
        className="sm:max-w-2xl"
        options={VIEWS}
        value={view}
        onValueChange={chooseView}
        disabled={busy}
      />
      {view === 'setari' ? (
        // The settings, and the log of their changes beside them once it has
        // a row.
        <PageGrid columns={hasLog ? 2 : 1} alignHeaders={hasLog}>
          <SettingsPanel
            thresholds={thresholds.data}
            evaluations={evaluations.data}
            disabled={busy}
            onRun={onRun}
            onSetting={onSetting}
          />
          {hasLog && <ChangeLogPanel evaluations={evaluations.data} />}
        </PageGrid>
      ) : (
        <PageGrid columns={1}>
          <RunPanel
            kind={view}
            {...draftOf(view)}
            evaluations={evaluations.data}
            disabled={busy}
            onRun={onRun}
          />
          {view === 'voluntar_activ' && hasCandidates && (
            <CandidatesPanel disabled={busy} onRun={onRun} />
          )}
          {hasSignals(view) && (
            <SignalsPanel kind={view} evaluations={evaluations.data} />
          )}
          {hasRun(view) && (
            <HistoryPanel kind={view} evaluations={evaluations.data} />
          )}
        </PageGrid>
      )}
    </ReceiptTurnScope>
  );
}
