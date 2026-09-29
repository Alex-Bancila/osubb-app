import { useId, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Gauge, History, Play, TriangleAlert, UserCheck } from 'lucide-react';
import { cn } from 'cn';
import {
  DataTable,
  type DataTableColumn,
} from '../../components/data-table/DataTable';
import {
  EmptyState,
  ListRow,
  PageGrid,
  Panel,
  SegmentedToggle,
  SubHeading,
  rowListClass,
} from '../../components/layout';
import { MemberName } from '../../components/member/MemberName';
import type { MemberIdentity } from '../../components/member/member-identity';
import { ErrorState, Loading } from '../../components/states';
import { Button, buttonVariants } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { FieldError } from '../../components/ui/field';
import { bucharestDayKey } from '../../lib/calendar-time';
import { describeFailure } from '../../lib/command-reasons';
import { formatPointCount, formatPoints, pointWord } from '../../lib/format';
import {
  percentFieldForReason,
  percentSchema,
  rejectionFieldForReason,
  rejectionSchema,
  runFieldForReason,
  runSchema,
  thresholdFieldForReason,
  thresholdSchema,
  type RoleEvaluationKind,
} from '../../lib/schemas/role-evaluation';
import { useFormValidation } from '../../lib/use-form-validation';
import { useMemberIdentities } from '../../queries/member-identities';
import {
  latestRun,
  percentText,
  retentionSignals,
  useEvaluationPercents,
  usePromotionCandidates,
  usePromotionThresholds,
  useRoleEvaluationCommand,
  useRoleEvaluationRanking,
  useRoleEvaluations,
  useThresholdChanges,
  type EvaluationPercent,
  type PromotionCandidate,
  type PromotionThreshold,
  type RoleEvaluation,
  type RoleEvaluationCommand,
  type RunResult,
  type ThresholdChange,
} from '../../queries/role-evaluations';
import { ROLE_PANEL_MEMBER_PARAM } from './RolePanel';
import { useReceiptTurn } from '../tracker/receipt-turn';
import { ReceiptTurnScope } from '../tracker/ReceiptTurnScope';
import {
  computedThresholdText,
  defaultRangeStart,
  formatDay,
  promoteHref,
  runConsequences,
  runResultText,
} from './role-evaluation-text';

const control =
  'min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm';

const KINDS: readonly RoleEvaluationKind[] = [
  'voluntar_activ',
  'adunarea_generala',
];

/** The kind as the tab names it. */
const KIND_LABEL: Record<string, string> = {
  voluntar_activ: 'Voluntar Activ',
  adunarea_generala: 'Adunarea Generală',
};

/** "Pragul …": the form each kind takes after it. */
const THRESHOLD_NAME: Record<RoleEvaluationKind, string> = {
  voluntar_activ: 'Voluntar Activ',
  adunarea_generala: 'Adunării Generale',
};

/** Whose ranking each kind's share is taken from (x, y; #866). */
const COHORT_NAME: Record<RoleEvaluationKind, string> = {
  voluntar_activ: 'Voluntarilor Activi',
  adunarea_generala: 'Voluntarilor cu Drept de Vot',
};

/** The Role a Retention Signal is about. */
const HOLDER_LABEL: Record<string, string> = {
  activ: 'Voluntar Activ',
  vot: 'Voluntar cu Drept de Vot',
};

type Run = (command: RoleEvaluationCommand) => Promise<RunResult | null>;

/** An instant's day in Romania, as `01.02.2026`. */
function formatInstantDay(instant: string): string {
  return formatDay(bucharestDayKey(instant));
}

function rangeText(run: Pick<RoleEvaluation, 'period_from' | 'period_to'>) {
  return `${formatDay(run.period_from)}–${formatDay(run.period_to)}`;
}

type Identities = Map<string, MemberIdentity> | undefined;

/** A name button for a Member the identities read may not have answered yet. */
function Name({
  memberId,
  identities,
}: {
  memberId: string;
  identities: Identities;
}) {
  const identity = identities?.get(memberId);
  return (
    <MemberName
      size="sm"
      memberId={memberId}
      nickname={identity?.nickname}
      fullName={identity?.fullName ?? 'Membru OSUBB'}
      avatarColor={identity?.avatarColor}
    />
  );
}

/** The name an action's accessible label repeats. */
function shownName(memberId: string, identities: Identities) {
  const identity = identities?.get(memberId);
  return identity?.nickname?.trim() || identity?.fullName || 'Membru OSUBB';
}

/* ------------------------------------------------------------------------ */
/* Rulează o evaluare de rol                                                 */
/* ------------------------------------------------------------------------ */

function RunPanel({
  evaluations,
  thresholds,
  disabled,
  onRun,
}: {
  evaluations: readonly RoleEvaluation[];
  thresholds: readonly PromotionThreshold[];
  disabled: boolean;
  onRun: Run;
}) {
  const fromId = useId();
  const toId = useId();
  const nameId = useId();
  const blockedId = useId();
  const today = bucharestDayKey(new Date()) ?? '';
  // x and y as the server holds them now (#866): the confirmation names the
  // shares the run will read, refreshed after every share edit.
  const percents = useEvaluationPercents();
  // "De la" starts the day after the kind's last range, never after today;
  // "Până la" is today.
  const defaultFrom = (kind: RoleEvaluationKind) =>
    defaultRangeStart(latestRun(evaluations, kind)?.period_to, today);
  const [kind, setKind] = useState<RoleEvaluationKind>('voluntar_activ');
  const [from, setFrom] = useState(() => defaultFrom('voluntar_activ'));
  const [to, setTo] = useState(today);
  const [name, setName] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // One receipt at a time across the tab (F-11).
  const turn = useReceiptTurn();
  const schema = useMemo(() => runSchema(today), [today]);
  const form = useFormValidation(
    schema,
    { kind, from, to, name },
    runFieldForReason,
  );
  const threshold =
    thresholds.find((row) => row.kind === kind)?.threshold ?? null;
  const parsed = schema.safeParse({ kind, from, to, name });
  const x = percentText(percents.data, 'voluntar_activ');
  const y = percentText(percents.data, 'adunarea_generala');

  function choose(next: RoleEvaluationKind) {
    setKind(next);
    setFrom(defaultFrom(next));
    setMessage(null);
    form.reset();
  }

  function review(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    if (form.validate()) setConfirming(true);
  }

  async function confirm() {
    if (!parsed.success) return;
    const values = parsed.data;
    try {
      const result = await onRun({
        kind: 'run',
        evaluationKind: values.kind,
        from: values.from,
        to: values.to,
        name: values.name,
      });
      setConfirming(false);
      setMessage(
        runResultText({
          kind: values.kind,
          name: values.name,
          candidates: result?.candidates ?? 0,
          retentionSignals: result?.retentionSignals ?? 0,
        }),
      );
      turn.claim();
      setName('');
      setFrom(defaultRangeStart(values.to, today));
      setTo(today);
    } catch (failure) {
      setConfirming(false);
      form.fail(failure, 'Nu am putut rula evaluarea. Reîncearcă.');
    }
  }

  return (
    <Panel
      eyebrow="Evaluări de rol"
      icon={Play}
      title="Rulează o evaluare de rol"
      description="Clasează punctele de task dintr-un interval ales acum. Nu schimbă niciun rol."
    >
      <form onSubmit={review} noValidate className="grid gap-4">
        <div className="grid gap-1.5" {...form.slot('kind')}>
          <span className="text-sm font-medium" aria-hidden="true">
            Tip
          </span>
          <SegmentedToggle
            label="Tip"
            options={KINDS.map((value) => ({
              value,
              label: KIND_LABEL[value],
            }))}
            value={kind}
            onChange={choose}
            // Under 640 px a long label wraps inside its pill, never past it (F-22).
            className="w-full *:flex-1 max-sm:*:px-2.5 max-sm:*:text-center max-sm:*:leading-tight max-sm:*:whitespace-normal sm:w-auto sm:justify-self-start"
          />
          <FieldError {...form.errorProps('kind')} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid min-w-0 content-start gap-1.5">
            <label htmlFor={fromId} className="text-sm font-medium">
              De la
            </label>
            <input
              id={fromId}
              type="date"
              className={control}
              value={from}
              max={today}
              disabled={disabled}
              onChange={(event) => setFrom(event.target.value)}
              {...form.field('from')}
            />
            <FieldError {...form.errorProps('from')} />
          </div>
          <div className="grid min-w-0 content-start gap-1.5">
            <label htmlFor={toId} className="text-sm font-medium">
              Până la
            </label>
            <input
              id={toId}
              type="date"
              className={control}
              value={to}
              max={today}
              disabled={disabled}
              onChange={(event) => setTo(event.target.value)}
              {...form.field('to')}
            />
            <FieldError {...form.errorProps('to')} />
          </div>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={nameId} className="text-sm font-medium">
            Nume
          </label>
          <input
            id={nameId}
            className={control}
            value={name}
            placeholder="Semestrul I 2026–2027"
            disabled={disabled}
            onChange={(event) => setName(event.target.value)}
            {...form.field('name')}
          />
          <FieldError {...form.errorProps('name')} />
        </div>
        <FieldError>{form.formError}</FieldError>
        <div className="grid gap-2">
          <Button
            type="submit"
            className="w-full sm:w-auto sm:justify-self-start"
            disabled={disabled || threshold === null}
            aria-describedby={threshold === null ? blockedId : undefined}
          >
            Rulează evaluarea
          </Button>
          {threshold === null && (
            <p id={blockedId} className="m-0 text-sm text-muted-foreground">
              Setează întâi pragul {THRESHOLD_NAME[kind]} din cardul Praguri.
            </p>
          )}
        </div>
        {message && turn.current && (
          <p role="status" className="m-0 text-sm font-medium">
            {message}
          </p>
        )}
      </form>
      <Dialog
        open={confirming}
        onOpenChange={(next) => !disabled && setConfirming(next)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Rulezi evaluarea „{parsed.success ? parsed.data.name : name}”?
            </DialogTitle>
            <DialogDescription>
              {parsed.success && threshold !== null
                ? runConsequences({
                    kind: parsed.data.kind,
                    from: parsed.data.from,
                    to: parsed.data.to,
                    threshold,
                    x,
                    y,
                  })
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() => setConfirming(false)}
            >
              Renunță
            </Button>
            <Button
              type="button"
              disabled={disabled}
              onClick={() => void confirm()}
            >
              Rulează evaluarea
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

/* ------------------------------------------------------------------------ */
/* Praguri                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * A kind's top share (#866, ruling R30): `Procent: x %` under the threshold,
 * edited in place as the threshold is — a whole 1–100 with the percent sign
 * fixed inside the field, so BC types only the number.
 */
function PercentEditor({
  kind,
  percent,
  identities,
  disabled,
  onRun,
}: {
  kind: RoleEvaluationKind;
  percent: EvaluationPercent | undefined;
  identities: Identities;
  disabled: boolean;
  onRun: Run;
}) {
  const inputId = useId();
  const hintId = useId();
  const label = `Procentul ${THRESHOLD_NAME[kind]}`;
  const current = percent?.percent ?? null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  // One receipt at a time across the tab (F-11).
  const turn = useReceiptTurn();
  const form = useFormValidation(
    percentSchema,
    { percent: draft },
    percentFieldForReason,
  );
  // The hint follows what BC types while it is a valid share.
  const typed = percentSchema.safeParse({ percent: draft });
  const shown = typed.success ? typed.data.percent : (current ?? 'x');

  function open() {
    setDraft(current === null ? '' : String(current));
    setMessage(null);
    form.reset();
    setEditing(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const values = form.validate();
    if (!values) return;
    try {
      await onRun({
        kind: 'percent',
        evaluationKind: kind,
        percent: values.percent,
      });
      setEditing(false);
      setMessage(`${label} a fost salvat.`);
      turn.claim();
    } catch (failure) {
      form.fail(failure, 'Nu am putut salva procentul. Reîncearcă.');
    }
  }

  return (
    <div className="grid gap-2">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="m-0 flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm">
          <span className="text-muted-foreground">Procent:</span>
          <span className="font-semibold tabular-nums">
            {current === null ? '—' : `${current} %`}
          </span>
          {percent?.changedBy && (
            <>
              <span aria-hidden="true" className="text-muted-foreground">
                ·
              </span>
              <span className="text-muted-foreground">schimbat de</span>
              <Name memberId={percent.changedBy} identities={identities} />
            </>
          )}
        </p>
        {!editing && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={open}
            aria-label={`Editează: ${label}`}
          >
            Editează procentul
          </Button>
        )}
      </div>
      {editing && (
        <form onSubmit={save} noValidate className="grid gap-1.5">
          <label htmlFor={inputId} className="text-sm font-medium">
            {label}
          </label>
          <div className="flex min-w-0 flex-wrap gap-2">
            <div className="relative w-28 flex-none">
              <input
                id={inputId}
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                step={1}
                className={cn(control, 'pr-9')}
                value={draft}
                disabled={disabled}
                onChange={(event) => setDraft(event.target.value)}
                {...form.field('percent', hintId)}
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground"
              >
                %
              </span>
            </div>
            <Button type="submit" disabled={disabled}>
              Salvează
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={disabled}
              onClick={() => setEditing(false)}
            >
              Renunță
            </Button>
          </div>
          <p id={hintId} className="m-0 text-sm text-muted-foreground">
            {`Un număr întreg de la 1 la 100. Pragul calculat este punctajul ultimului din primii ${shown} % ai ${COHORT_NAME[kind]}. Se aplică de la următoarea evaluare; evaluările rulate nu se recalculează.`}
          </p>
          <FieldError {...form.errorProps('percent')} />
          <FieldError>{form.formError}</FieldError>
        </form>
      )}
      {message && turn.current && (
        <p role="status" className="m-0 text-sm">
          {message}
        </p>
      )}
    </div>
  );
}

function ThresholdRow({
  kind,
  row,
  source,
  percent,
  runName,
  identities,
  disabled,
  onRun,
}: {
  kind: RoleEvaluationKind;
  row: PromotionThreshold | undefined;
  /** The kind's latest threshold change: where the value in force came from. */
  source: ThresholdChange | undefined;
  /** The kind's top share in force, x or y (#866). */
  percent: EvaluationPercent | undefined;
  runName: (id: number | null) => string;
  identities: Identities;
  disabled: boolean;
  onRun: Run;
}) {
  const inputId = useId();
  const hintId = useId();
  const label = `Pragul ${THRESHOLD_NAME[kind]}`;
  const current = row?.threshold ?? null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  // One receipt at a time across the tab (F-11).
  const turn = useReceiptTurn();
  const form = useFormValidation(
    thresholdSchema,
    { threshold: draft },
    thresholdFieldForReason,
  );

  function open() {
    setDraft(current === null ? '' : String(current));
    setMessage(null);
    form.reset();
    setEditing(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const values = form.validate();
    if (!values) return;
    try {
      await onRun({
        kind: 'threshold',
        evaluationKind: kind,
        threshold: values.threshold,
      });
      setEditing(false);
      setMessage(`${label} a fost salvat.`);
      turn.claim();
    } catch (failure) {
      form.fail(failure, 'Nu am putut salva pragul. Reîncearcă.');
    }
  }

  return (
    <li className="grid gap-2 py-3 first:pt-0">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <SubHeading variant="label">{label}</SubHeading>
          <p className="m-0 text-2xl leading-tight font-bold tabular-nums">
            {current === null ? (
              <span className="text-muted-foreground">Nesetat</span>
            ) : (
              <>
                {formatPoints(current)}{' '}
                <span className="text-sm font-medium text-muted-foreground">
                  {pointWord(current)}
                </span>
              </>
            )}
          </p>
          {current !== null && source && (
            <p className="m-0 flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground">
              {source.source === 'manual' && source.changed_by ? (
                <>
                  introdus de
                  <Name memberId={source.changed_by} identities={identities} />
                </>
              ) : (
                <>
                  calculat de evaluarea „{runName(source.role_evaluation_id)}”
                </>
              )}
            </p>
          )}
        </div>
        {!editing && (
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={open}
            aria-label={`Editează: ${label}`}
          >
            Editează
          </Button>
        )}
      </div>
      {editing && (
        <form onSubmit={save} noValidate className="grid gap-1.5">
          <label htmlFor={inputId} className="text-sm font-medium">
            {label}
          </label>
          <div className="flex min-w-0 flex-wrap gap-2">
            <input
              id={inputId}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              className={cn(control, 'w-32 flex-none')}
              value={draft}
              disabled={disabled}
              onChange={(event) => setDraft(event.target.value)}
              {...form.field('threshold', hintId)}
            />
            <Button type="submit" disabled={disabled}>
              Salvează
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={disabled}
              onClick={() => setEditing(false)}
            >
              Renunță
            </Button>
          </div>
          <p id={hintId} className="m-0 text-sm text-muted-foreground">
            Puncte de task. Următoarea evaluare de acest tip folosește pragul în
            vigoare și calculează unul nou.
          </p>
          <FieldError {...form.errorProps('threshold')} />
          <FieldError>{form.formError}</FieldError>
        </form>
      )}
      {message && turn.current && (
        <p role="status" className="m-0 text-sm">
          {message}
        </p>
      )}
      <PercentEditor
        kind={kind}
        percent={percent}
        identities={identities}
        disabled={disabled}
        onRun={onRun}
      />
    </li>
  );
}

function ThresholdsPanel({
  thresholds,
  evaluations,
  disabled,
  onRun,
}: {
  thresholds: readonly PromotionThreshold[];
  evaluations: readonly RoleEvaluation[];
  disabled: boolean;
  onRun: Run;
}) {
  const changes = useThresholdChanges();
  const percents = useEvaluationPercents();
  const memberIds = useMemo(
    () =>
      (changes.data ?? []).flatMap((change) =>
        change.changed_by ? [change.changed_by] : [],
      ),
    [changes.data],
  );
  const identities = useMemberIdentities(memberIds);
  const runName = (id: number | null) =>
    evaluations.find((run) => run.id === id)?.name ?? '…';

  return (
    <Panel
      eyebrow="Evaluări de rol"
      icon={Gauge}
      title="Praguri"
      description="Punctele de task cu care fiecare tip de evaluare compară membrii și procentul din clasament din care calculează pragul următor."
      boxClassName="grid content-start gap-3"
    >
      <ul className={rowListClass}>
        {KINDS.map((kind) => (
          <ThresholdRow
            key={kind}
            kind={kind}
            row={thresholds.find((row) => row.kind === kind)}
            source={changes.data?.find(
              (change) => change.kind === kind && change.field !== 'percent',
            )}
            percent={percents.data?.find((row) => row.kind === kind)}
            runName={runName}
            identities={identities.data}
            disabled={disabled}
            onRun={onRun}
          />
        ))}
      </ul>
      {/* The log appears with its first change (B58): an empty "Nicio
          schimbare încă" block tells BC nothing before anything happened. */}
      {!(changes.isSuccess && changes.data.length === 0) && (
        <div className="grid gap-2 border-t border-(--border-soft) pt-3">
          <SubHeading variant="label">Istoricul pragurilor</SubHeading>
          {changes.isPending ? (
            <Loading label="Se încarcă istoricul pragurilor…" />
          ) : changes.isError ? (
            <ErrorState
              text="Nu am putut încărca istoricul pragurilor."
              onRetry={() => void changes.refetch()}
            />
          ) : (
            <ul
              className={cn(rowListClass, 'max-h-80 overflow-y-auto text-sm')}
              aria-label="Istoricul pragurilor"
            >
              {changes.data.map((change) => (
                <li key={change.id} className="grid min-w-0 gap-0.5 py-2">
                  <span className="text-muted-foreground tabular-nums">
                    {formatInstantDay(change.changed_at)} ·{' '}
                    {KIND_LABEL[change.kind] ?? change.kind}
                    {change.field === 'percent' && ' · procent'}
                  </span>
                  <span className="flex min-w-0 flex-wrap items-center gap-x-1.5">
                    <span className="font-semibold tabular-nums">
                      {change.field === 'percent'
                        ? `${change.from_value ?? '—'} % → ${change.to_value} %`
                        : `${
                            change.from_value === null
                              ? 'nesetat'
                              : formatPoints(change.from_value)
                          } → ${formatPoints(change.to_value)}`}
                    </span>
                    <span aria-hidden="true" className="text-muted-foreground">
                      ·
                    </span>
                    {change.source === 'manual' && change.changed_by ? (
                      <Name
                        memberId={change.changed_by}
                        identities={identities.data}
                      />
                    ) : (
                      <span className="text-muted-foreground">
                        evaluarea „{runName(change.role_evaluation_id)}”
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------------ */
/* Candidați la promovare                                                    */
/* ------------------------------------------------------------------------ */

/** Refusals after which the row itself is gone: the panel reports them. */
const STALE_CANDIDATE = new Set([
  'promotion_candidate_not_found',
  'promotion_candidate_decided',
]);

function RejectDialog({
  candidate,
  name,
  disabled,
  onRun,
  onStale,
  identities,
}: {
  candidate: PromotionCandidate;
  name: string;
  disabled: boolean;
  onRun: Run;
  /** The candidate left the list meanwhile; the dialog closes with its row. */
  onStale: (message: string) => void;
  identities: Identities;
}) {
  const reasonId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const form = useFormValidation(
    rejectionSchema,
    { reason },
    rejectionFieldForReason,
  );

  function reset(next: boolean) {
    setOpen(next);
    if (next) {
      setReason('');
      form.reset();
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const values = form.validate();
    if (!values) return;
    try {
      await onRun({
        kind: 'reject',
        candidateId: candidate.id,
        reason: values.reason,
      });
      setOpen(false);
    } catch (failure) {
      const fallback = 'Nu am putut respinge candidatul. Reîncearcă.';
      const { reason: refusal, message } = describeFailure(failure, fallback);
      if (refusal && STALE_CANDIDATE.has(refusal)) {
        setOpen(false);
        onStale(message);
      } else form.fail(failure, fallback);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !disabled && reset(next)}>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => reset(true)}
        aria-label={`Respinge: ${name}`}
      >
        Respinge
      </Button>
      <DialogContent>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Respingi candidatul?</DialogTitle>
            <DialogDescription>
              Candidatul rămâne Voluntar. Respingerea ține doar pentru evaluarea
              „{candidate.evaluationName}”: dacă la o evaluare viitoare are din
              nou cel puțin pragul, reapare în listă.
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm">
            <Name memberId={candidate.memberId} identities={identities} />
            <span className="text-muted-foreground tabular-nums">
              {formatPointCount(candidate.taskPoints)} · pragul{' '}
              {formatPoints(candidate.thresholdUsed)}
            </span>
          </div>
          <div className="grid gap-1.5">
            <label htmlFor={reasonId} className="text-sm font-medium">
              Motivul respingerii
            </label>
            <textarea
              id={reasonId}
              rows={3}
              className={control}
              value={reason}
              required
              disabled={disabled}
              onChange={(event) => setReason(event.target.value)}
              {...form.field('reason')}
            />
            <FieldError {...form.errorProps('reason')} />
          </div>
          <FieldError>{form.formError}</FieldError>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() => setOpen(false)}
            >
              Renunță
            </Button>
            <Button type="submit" variant="destructive" disabled={disabled}>
              Respinge candidatul
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CandidatesPanel({
  disabled,
  onRun,
}: {
  disabled: boolean;
  onRun: Run;
}) {
  const candidates = usePromotionCandidates();
  const memberIds = useMemo(
    () => (candidates.data ?? []).map((candidate) => candidate.memberId),
    [candidates.data],
  );
  const identities = useMemberIdentities(memberIds);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <Panel
      eyebrow="Roluri"
      icon={UserCheck}
      title="Candidați la promovare"
      description="Voluntari cu vechimea cerută și cel puțin pragul Voluntar Activ. Nimeni nu este promovat automat: BC decide în panoul de roluri."
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
                      className={cn(buttonVariants())}
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
                  {formatPointCount(candidate.taskPoints)} · pragul{' '}
                  {formatPoints(candidate.thresholdUsed)} · vechime din{' '}
                  {formatDay(candidate.tenureSince)}
                </p>
                <p className="m-0 text-sm text-muted-foreground">
                  Evaluarea „{candidate.evaluationName}”
                </p>
              </ListRow>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------------ */
/* Semnale de retenție                                                       */
/* ------------------------------------------------------------------------ */

function SignalsSection({
  kind,
  run,
}: {
  kind: RoleEvaluationKind;
  run: RoleEvaluation | undefined;
}) {
  const titleId = useId();
  const ranking = useRoleEvaluationRanking(run);
  const signals = useMemo(
    () => (run && ranking.data ? retentionSignals(run, ranking.data) : []),
    [run, ranking.data],
  );
  const identities = useMemberIdentities(
    signals.map((signal) => signal.memberId),
  );
  return (
    <section aria-labelledby={titleId} className="grid min-w-0 content-start">
      <div className="grid min-w-0 gap-0.5 border-b border-(--border-soft) pb-2">
        <SubHeading id={titleId} variant="label">
          {KIND_LABEL[kind]}
        </SubHeading>
        {run && (
          <p className="m-0 text-sm text-muted-foreground">
            {run.name} · {rangeText(run)} · pragul{' '}
            {formatPoints(run.threshold_used)}
          </p>
        )}
      </div>
      {!run ? (
        <EmptyState>Nicio evaluare de acest tip încă.</EmptyState>
      ) : ranking.isPending ? (
        <Loading label="Se încarcă semnalele…" />
      ) : ranking.isError ? (
        <ErrorState
          text="Nu am putut încărca semnalele de retenție."
          onRetry={() => void ranking.refetch()}
        />
      ) : signals.length === 0 ? (
        <EmptyState>Niciun semnal la ultima evaluare.</EmptyState>
      ) : (
        <ul
          className={rowListClass}
          aria-label={`Semnale de retenție: ${KIND_LABEL[kind]}`}
        >
          {signals.map((signal) => {
            const name = shownName(signal.memberId, identities.data);
            return (
              <ListRow
                key={signal.memberId}
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
                  {HOLDER_LABEL[signal.role] ?? signal.role} ·{' '}
                  {formatPointCount(signal.taskPoints)} · locul {signal.rank}{' '}
                  din {signal.cohortSize}
                </p>
              </ListRow>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function SignalsPanel({
  evaluations,
}: {
  evaluations: readonly RoleEvaluation[];
}) {
  return (
    <Panel
      eyebrow="Roluri"
      icon={TriangleAlert}
      title="Semnale de retenție"
      description="Deținătorii rolului sub pragul folosit la ultima evaluare de fiecare tip. Retragerea unui rol este decizia BC, din panoul de roluri."
      boxClassName="grid gap-6 lg:grid-cols-2"
    >
      {KINDS.map((kind) => (
        <SignalsSection
          key={kind}
          kind={kind}
          run={latestRun(evaluations, kind)}
        />
      ))}
    </Panel>
  );
}

/* ------------------------------------------------------------------------ */
/* Istoricul evaluărilor                                                     */
/* ------------------------------------------------------------------------ */

function historyColumns(
  identities: Identities,
): DataTableColumn<RoleEvaluation>[] {
  return [
    {
      id: 'name',
      accessorFn: (row) => row.name,
      header: 'Nume',
      enableSorting: false,
      cell: ({ row }) => (
        <span className="font-medium">{row.original.name}</span>
      ),
    },
    {
      id: 'kind',
      accessorFn: (row) => KIND_LABEL[row.kind] ?? row.kind,
      header: 'Tip',
      enableSorting: false,
    },
    {
      id: 'range',
      accessorFn: (row) => rangeText(row),
      header: 'Interval',
      enableSorting: false,
    },
    {
      id: 'run_by',
      accessorFn: (row) => row.run_by,
      header: 'Rulată de',
      enableSorting: false,
      cell: ({ row }) => (
        <Name memberId={row.original.run_by} identities={identities} />
      ),
    },
    {
      id: 'run_at',
      accessorFn: (row) => row.run_at,
      header: 'Data',
      enableSorting: false,
      cell: ({ row }) => formatInstantDay(row.original.run_at),
    },
    {
      id: 'threshold_used',
      accessorFn: (row) => row.threshold_used,
      header: 'Prag folosit',
      enableSorting: false,
      cell: ({ row }) => formatPoints(row.original.threshold_used),
    },
    {
      id: 'threshold_computed',
      accessorFn: (row) => row.threshold_computed,
      header: 'Prag calculat',
      enableSorting: false,
      // Below 1 the value is not taken over: the threshold used (beside it)
      // stays in force (Audit D-9).
      cell: ({ row }) => computedThresholdText(row.original.threshold_computed),
    },
  ];
}

function HistoryPanel({
  evaluations,
}: {
  evaluations: readonly RoleEvaluation[];
}) {
  const identities = useMemberIdentities(evaluations.map((run) => run.run_by));
  const columns = useMemo(
    () => historyColumns(identities.data),
    [identities.data],
  );
  const rows = useMemo(() => [...evaluations], [evaluations]);
  return (
    <Panel
      eyebrow="Evaluări de rol"
      icon={History}
      title="Istoricul evaluărilor"
      description="Fiecare evaluare rulată, cea mai recentă prima."
    >
      {/* Mounted only once a run exists (B58). */}
      <DataTable
        columns={columns}
        data={rows}
        emptyTitle="Nicio evaluare de rol încă."
        // A name keeps at least a word at 375 px (F-22).
        columnClassName={{ run_by: 'min-w-36' }}
      />
    </Panel>
  );
}

/**
 * Administrare → **Evaluări de rol** (#827; ruling R28, over #826): BC or the
 * Moderator runs a Role Evaluation of one kind over an Evaluation Period,
 * edits the two Promotion Thresholds and reads their log, decides the
 * Promotion Candidates (promotion itself stays in the Role panel), reads each
 * kind's Retention Signals and the history of runs. Mounted behind
 * `manageRoles`; every command decides again on the server (level 6).
 */
export default function RoleEvaluationsScreen() {
  const evaluations = useRoleEvaluations();
  const thresholds = usePromotionThresholds();
  const command = useRoleEvaluationCommand();
  const run: Run = (next) => command.mutateAsync(next);

  if (evaluations.isPending || thresholds.isPending)
    return <Loading label="Se încarcă evaluările de rol…" />;
  if (evaluations.isError || thresholds.isError)
    return (
      <ErrorState
        text="Nu am putut încărca evaluările de rol."
        onRetry={() => {
          void evaluations.refetch();
          void thresholds.refetch();
        }}
      />
    );
  // Until the first run only Run and Praguri have anything to say (B58): the
  // candidates, signals and history panels appear with their first row.
  const hasRun = evaluations.data.length > 0;
  return (
    <ReceiptTurnScope>
      <PageGrid columns={2} alignHeaders>
        <RunPanel
          evaluations={evaluations.data}
          thresholds={thresholds.data}
          disabled={command.isPending}
          onRun={run}
        />
        <ThresholdsPanel
          thresholds={thresholds.data}
          evaluations={evaluations.data}
          disabled={command.isPending}
          onRun={run}
        />
      </PageGrid>
      {hasRun && (
        <PageGrid columns={1}>
          <CandidatesPanel disabled={command.isPending} onRun={run} />
          <SignalsPanel evaluations={evaluations.data} />
          <HistoryPanel evaluations={evaluations.data} />
        </PageGrid>
      )}
    </ReceiptTurnScope>
  );
}
