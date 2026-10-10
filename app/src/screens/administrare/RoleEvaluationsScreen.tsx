import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Link } from 'react-router';
import { Pencil, UserCheck, UserX } from 'lucide-react';
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
import { DatePicker } from '../../components/ui/date-picker';
import { FieldError } from '../../components/ui/field';
import { InfoHint } from '../../components/ui/info-hint';
import { Input, Textarea } from '../../components/ui/input';
import { SegmentedRadio } from '../../components/ui/segmented-radio';
import { Badge } from '../../components/ui/badge';
import { SwitchRow } from '../../components/ui/switch';
import { bucharestDayKey } from '../../lib/calendar-time';
import { describeFailure } from '../../lib/command-reasons';
import {
  formatMonthCount,
  formatPointCount,
  formatPoints,
} from '../../lib/format';
import {
  percentFieldForReason,
  percentSchema,
  promotionRuleFieldForReason,
  promotionRuleSchema,
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
  NO_SUBJECTS,
  PROMOTION_CANDIDATES_SUBJECT,
  useReadNotificationsAbout,
} from '../../queries/notifications';
import {
  latestRun,
  percentText,
  retentionSignals,
  useEvaluationPercents,
  usePromotionCandidates,
  usePromotionRules,
  usePromotionThresholds,
  useRoleEvaluationCommand,
  useRoleEvaluationRanking,
  useRoleEvaluations,
  useThresholdChanges,
  type EvaluationPercent,
  type PromotionCandidate,
  type PromotionRule,
  type PromotionThreshold,
  type RoleEvaluation,
  type RoleEvaluationCommand,
  type RunResult,
  type ThresholdChange,
} from '../../queries/role-evaluations';
import { useMinWidth } from '../volunteers/use-min-width';
import { ROLE_PANEL_MEMBER_PARAM } from './RolePanel';
import { useReceiptTurn } from '../tracker/receipt-turn';
import { ReceiptTurnScope } from '../tracker/ReceiptTurnScope';
import {
  computedThresholdText,
  defaultRangeStart,
  formatDay,
  formatInstantDay,
  promoteHref,
  runConsequences,
  runResultText,
} from './role-evaluation-text';

const KINDS: readonly RoleEvaluationKind[] = [
  'voluntar_activ',
  'adunarea_generala',
];

/**
 * What the page's Tip switch offers: the two Role Evaluation kinds, and the
 * promotion no evaluation runs — Recrut → Voluntar, by tenure alone.
 */
const TENURE_VIEW = 'vechime';
type View = RoleEvaluationKind | typeof TENURE_VIEW;
const TENURE_VIEW_LABEL = 'Vechime';

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
  kind,
  evaluations,
  thresholds,
  disabled,
  onRun,
}: {
  /** The page's Tip: the kind this run is of. */
  kind: RoleEvaluationKind;
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
  const defaultFrom = (of: RoleEvaluationKind) =>
    defaultRangeStart(latestRun(evaluations, of)?.period_to, today);
  const [from, setFrom] = useState(() => defaultFrom(kind));
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
  // Each date is checked when the member leaves its field (the picker does
  // not count opening its calendar as leaving) and ends today.
  const fromField = form.field('from');
  const toField = form.field('to');
  const x = percentText(percents.data, 'voluntar_activ');
  const y = percentText(percents.data, 'adunarea_generala');

  // Another kind on the page's switch: its own "De la", and nothing said
  // about the kind before it. The name and "Până la" stay as typed.
  const [shownKind, setShownKind] = useState(kind);
  if (shownKind !== kind) {
    setShownKind(kind);
    setFrom(defaultFrom(kind));
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
      title="Rulează o evaluare de rol"
      control={
        <InfoHint label="Despre evaluarea de rol">
          Clasează punctele de task dintr-un interval ales acum. Nu schimbă
          niciun rol.
        </InfoHint>
      }
    >
      <form onSubmit={review} noValidate className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid min-w-0 content-start gap-1.5">
            <label htmlFor={fromId} className="text-sm font-medium">
              De la
            </label>
            <DatePicker
              id={fromId}
              value={from}
              required
              max={today}
              disabled={disabled}
              onChange={setFrom}
              {...fromField}
            />
            <FieldError {...form.errorProps('from')} />
          </div>
          <div className="grid min-w-0 content-start gap-1.5">
            <label htmlFor={toId} className="text-sm font-medium">
              Până la
            </label>
            <DatePicker
              id={toId}
              value={to}
              required
              max={today}
              disabled={disabled}
              onChange={setTo}
              {...toField}
            />
            <FieldError {...form.errorProps('to')} />
          </div>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={nameId} className="text-sm font-medium">
            Nume
          </label>
          <Input
            id={nameId}
            value={name}
            required
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

/** The Role Evaluation kind a Promotion Rule feeds; `null` for none. */
function ruleEvaluationKind(
  rule: Pick<PromotionRule, 'kind'>,
): RoleEvaluationKind | null {
  // `time` is the daily job's (Recrut → Voluntar): no evaluation reads it.
  // `top_percent` is the tenure `run_role_evaluation` asks of a Voluntar
  // Activ candidate.
  return rule.kind === 'time' ? null : 'voluntar_activ';
}

/**
 * Where focus goes around an in-place editor: to its field when it opens,
 * back to the pencil that opened it when it closes (#923).
 */
function useEditorFocus(editing: boolean, fieldId: string) {
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing) document.getElementById(fieldId)?.focus();
    else if (wasEditing.current) editButton.current?.focus();
    wasEditing.current = editing;
  }, [editing, fieldId]);
  return editButton;
}

/**
 * One setting of the tab, as a row: its name (with an "i" for what it needs
 * said once), the value in force at the right in tabular figures, and its
 * controls — a pencil, and a switch for a rule. What belongs under the row
 * (where the value came from, the editor, the receipt) follows as children.
 */
function SettingRow({
  labelId,
  label,
  hint,
  value,
  controls,
  editing,
  children,
  ...attributes
}: {
  labelId: string;
  label: string;
  hint?: ReactNode;
  value: ReactNode;
  controls?: ReactNode;
  editing: boolean;
  children?: ReactNode;
  'data-rule'?: string;
  'aria-labelledby'?: string;
}) {
  return (
    <li
      data-slot="setting-row"
      data-editing={editing || undefined}
      className={cn(
        'grid min-w-0 gap-2 py-2 first:pt-0 last:pb-0',
        editing &&
          '-mx-3 rounded-lg bg-muted/40 px-3 py-3 first:pt-3 last:pb-3',
      )}
      {...attributes}
    >
      <div className="flex min-h-11 min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center">
          <SubHeading variant="label" id={labelId}>
            {label}
          </SubHeading>
          {hint}
        </div>
        <p
          data-slot="setting-value"
          className="m-0 shrink-0 text-right text-sm font-semibold tabular-nums"
        >
          {value}
        </p>
        {controls}
      </div>
      {children}
    </li>
  );
}

/** Salvează and Renunță of an in-place editor: the page's one filled button
 *  is the run form's, so neither is filled. */
function EditorActions({
  disabled,
  canSave = true,
  onCancel,
}: {
  disabled: boolean;
  canSave?: boolean;
  onCancel: () => void;
}) {
  return (
    <>
      <Button type="submit" variant="outline" disabled={disabled || !canSave}>
        Salvează
      </Button>
      <Button
        type="button"
        variant="ghost"
        disabled={disabled}
        onClick={onCancel}
      >
        Renunță
      </Button>
    </>
  );
}

/**
 * A kind's top share (#866, ruling R30): the row under the threshold, edited
 * in place as the threshold is — a whole 1–100 with the percent sign fixed
 * inside the field, so BC types only the number.
 */
function PercentRow({
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
  const labelId = useId();
  const inputId = useId();
  const hintId = useId();
  const label = `Procentul ${THRESHOLD_NAME[kind]}`;
  const current = percent?.percent ?? null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const editButton = useEditorFocus(editing, inputId);
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
    <SettingRow
      labelId={labelId}
      label={label}
      editing={editing}
      hint={
        !editing && (
          <InfoHint label="Despre procent">
            {`Pragul calculat este punctajul ultimului din primii ${current ?? 'x'} % ai ${COHORT_NAME[kind]}.`}
          </InfoHint>
        )
      }
      value={current === null ? '—' : `${current} %`}
      controls={
        !editing && (
          <Button
            ref={editButton}
            type="button"
            variant="outline"
            size="icon"
            disabled={disabled}
            onClick={open}
            aria-label={`Editează procentul ${THRESHOLD_NAME[kind]}`}
            title="Editează procentul"
          >
            <Pencil aria-hidden="true" />
          </Button>
        )
      }
    >
      {percent?.changedBy && !editing && (
        <p className="m-0 flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground">
          schimbat de
          <Name memberId={percent.changedBy} identities={identities} />
        </p>
      )}
      {editing && (
        // The row's name, right above, is the field's label.
        <form onSubmit={save} noValidate className="grid gap-1.5">
          <div className="flex min-w-0 flex-wrap gap-2">
            <div className="relative w-28 flex-none">
              <Input
                id={inputId}
                aria-labelledby={labelId}
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                step={1}
                className="pr-9"
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
            <EditorActions
              disabled={disabled}
              onCancel={() => setEditing(false)}
            />
          </div>
          <p id={hintId} className="m-0 text-sm text-muted-foreground">
            {`Un număr întreg de la 1 la 100. Pragul calculat este punctajul ultimului din primii ${shown} % ai ${COHORT_NAME[kind]}. Se aplică de la următoarea evaluare; evaluările rulate nu se recalculează.`}
          </p>
          <FieldError {...form.errorProps('percent')} />
          <FieldError>{form.formError}</FieldError>
        </form>
      )}
      {message && turn.current && (
        <p role="status" className="m-0 text-sm font-medium">
          {message}
        </p>
      )}
    </SettingRow>
  );
}

function ThresholdRow({
  kind,
  row,
  source,
  runName,
  identities,
  disabled,
  onRun,
}: {
  kind: RoleEvaluationKind;
  row: PromotionThreshold | undefined;
  /** The kind's latest threshold change: where the value in force came from. */
  source: ThresholdChange | undefined;
  runName: (id: number | null) => string;
  identities: Identities;
  disabled: boolean;
  onRun: Run;
}) {
  const labelId = useId();
  const inputId = useId();
  const hintId = useId();
  const label = `Pragul ${THRESHOLD_NAME[kind]}`;
  const current = row?.threshold ?? null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const editButton = useEditorFocus(editing, inputId);
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
    <SettingRow
      labelId={labelId}
      label={label}
      editing={editing}
      hint={
        !editing && (
          <InfoHint label="Despre prag">
            Puncte de task. Următoarea evaluare de acest tip folosește pragul în
            vigoare și calculează unul nou.
          </InfoHint>
        )
      }
      value={
        current === null ? (
          <span className="text-muted-foreground">Nesetat</span>
        ) : (
          formatPointCount(current)
        )
      }
      controls={
        !editing && (
          <Button
            ref={editButton}
            type="button"
            variant="outline"
            size="icon"
            disabled={disabled}
            onClick={open}
            aria-label={`Editează pragul ${THRESHOLD_NAME[kind]}`}
            title="Editează pragul"
          >
            <Pencil aria-hidden="true" />
          </Button>
        )
      }
    >
      {current !== null && source && !editing && (
        <p className="m-0 flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground">
          {source.source === 'manual' && source.changed_by ? (
            <>
              introdus de
              <Name memberId={source.changed_by} identities={identities} />
            </>
          ) : (
            <>calculat de evaluarea „{runName(source.role_evaluation_id)}”</>
          )}
        </p>
      )}
      {editing && (
        // The row's name, right above, is the field's label.
        <form onSubmit={save} noValidate className="grid gap-1.5">
          <div className="flex min-w-0 flex-wrap gap-2">
            <Input
              id={inputId}
              aria-labelledby={labelId}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              className="w-32 flex-none"
              value={draft}
              disabled={disabled}
              onChange={(event) => setDraft(event.target.value)}
              {...form.field('threshold', hintId)}
            />
            <EditorActions
              disabled={disabled}
              onCancel={() => setEditing(false)}
            />
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
        <p role="status" className="m-0 text-sm font-medium">
          {message}
        </p>
      )}
    </SettingRow>
  );
}

/* ------------------------------------------------------------------------ */
/* Reguli de promovare (#935): each rule's tenure and on/off                 */
/* ------------------------------------------------------------------------ */

/** The Roles a Promotion Rule joins, as the tab names them. */
const ROLE_NAME: Record<string, string> = {
  recrut: 'Recrut',
  voluntar: 'Voluntar',
  activ: 'Voluntar Activ',
  vot: 'Voluntar cu Drept de Vot',
};

function ruleLabel(rule: Pick<PromotionRule, 'fromRole' | 'toRole'>): string {
  return `${ROLE_NAME[rule.fromRole] ?? rule.fromRole} → ${ROLE_NAME[rule.toRole] ?? rule.toRole}`;
}

/**
 * What each rule does, on and off, and when an edit takes effect — checked
 * against the daily job (`time`) and `run_role_evaluation` (`top_percent`).
 */
type RuleText = { on: string; off: string; applies: string };

const TIME_RULE_TEXT: RuleText = {
  on: 'Zilnic, fiecare Recrut care a împlinit vechimea devine automat Voluntar.',
  off: 'Oprită: niciun Recrut nu mai devine Voluntar automat.',
  applies: 'Se aplică de la următoarea rulare zilnică.',
};

const TOP_PERCENT_RULE_TEXT: RuleText = {
  on: 'Un Voluntar cu această vechime devine candidat la promovare de îndată ce ajunge la prag, și la fiecare evaluare Voluntar Activ.',
  off: 'Oprită: nimeni nu mai devine candidat la promovare.',
  applies:
    'Se aplică imediat listei de candidați și de la următoarea evaluare Voluntar Activ; evaluările rulate nu se recalculează.',
};

function ruleText(kind: string): RuleText {
  return kind === 'time' ? TIME_RULE_TEXT : TOP_PERCENT_RULE_TEXT;
}

const RULE_SAVE_FAILED = 'Nu am putut salva regula. Reîncearcă.';

/**
 * One Promotion Rule as a row: its tenure is the value, a chip says whether
 * it is on, and what it does when on sits behind the "i". While it is off,
 * what that stops stays on the row. Nothing changes from the row itself: the
 * pencil opens #923's editor — the tenure and the on/off switch with Salvează
 * (only once something changed) and Renunță; focus goes back to the pencil
 * and the receipt is announced.
 */
function RuleRow({
  rule,
  lastChange,
  identities,
  disabled,
  onRun,
}: {
  rule: PromotionRule;
  /** The rule's latest change in the log, if any. */
  lastChange: ThresholdChange | undefined;
  identities: Identities;
  disabled: boolean;
  onRun: Run;
}) {
  const labelId = useId();
  const monthsId = useId();
  const hintId = useId();
  const label = ruleLabel(rule);
  const text = ruleText(rule.kind);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [months, setMonths] = useState('');
  const [enabled, setEnabled] = useState(rule.enabled);
  const [pending, setPending] = useState(false);
  // Opening focuses the tenure; closing returns focus to the pencil (#923).
  const editButton = useEditorFocus(editing, monthsId);
  const form = useFormValidation(
    promotionRuleSchema,
    { months, enabled },
    promotionRuleFieldForReason,
  );

  const changed =
    months.trim() !== String(rule.tenureMonths) || enabled !== rule.enabled;

  function open() {
    setMonths(String(rule.tenureMonths));
    setEnabled(rule.enabled);
    setSaved(false);
    form.reset();
    setEditing(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const values = form.validate();
    if (!values) return;
    setPending(true);
    try {
      await onRun({
        kind: 'rule',
        ruleId: rule.id,
        tenureMonths: values.months,
        enabled: values.enabled,
      });
      setSaved(true);
      setEditing(false);
    } catch (failure) {
      form.fail(failure, RULE_SAVE_FAILED);
    } finally {
      setPending(false);
    }
  }

  const busy = disabled || pending;
  return (
    <SettingRow
      data-rule={rule.kind}
      aria-labelledby={labelId}
      labelId={labelId}
      label={label}
      editing={editing}
      hint={
        !editing && (
          <InfoHint label={`Despre regula ${label}`}>{text.on}</InfoHint>
        )
      }
      value={
        <>
          <span className="sr-only">Vechime cerută: </span>
          {formatMonthCount(rule.tenureMonths)}
        </>
      }
      controls={
        !editing && (
          <>
            <Button
              ref={editButton}
              type="button"
              variant="outline"
              size="icon"
              disabled={busy}
              onClick={open}
              aria-label={`Editează regula ${label}`}
              title="Editează regula"
            >
              <Pencil aria-hidden="true" />
            </Button>
            {/* The state, not a control: a rule turns on or off only in
                its editor, with Salvează. */}
            <Badge
              variant={rule.enabled ? 'outline' : 'secondary'}
              data-slot="rule-state"
            >
              {rule.enabled ? 'Pornită' : 'Oprită'}
            </Badge>
          </>
        )
      }
    >
      {/* What an off rule stops is read before anything else is decided. */}
      {!rule.enabled && !editing && (
        <p className="m-0 text-sm text-muted-foreground">{text.off}</p>
      )}
      {lastChange?.changed_by && !editing && (
        <p className="m-0 flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground">
          schimbată de
          <Name memberId={lastChange.changed_by} identities={identities} />
        </p>
      )}
      {/* Always mounted, so the receipt is announced when it appears. */}
      <p role="status" className="m-0 text-sm font-medium empty:hidden">
        {saved && !editing ? 'Regula a fost salvată.' : null}
      </p>
      {editing && (
        <form
          onSubmit={save}
          noValidate
          aria-labelledby={labelId}
          className="grid gap-3"
        >
          <div className="grid gap-1.5">
            <label htmlFor={monthsId} className="text-sm font-medium">
              Vechime cerută
            </label>
            <div className="relative w-32">
              <Input
                id={monthsId}
                type="number"
                inputMode="numeric"
                min={0}
                max={120}
                step={1}
                className="pr-12"
                value={months}
                disabled={busy}
                onChange={(event) => setMonths(event.target.value)}
                {...form.field('months', hintId)}
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground"
              >
                luni
              </span>
            </div>
            <p id={hintId} className="m-0 text-sm text-muted-foreground">
              Luni întregi de la data intrării în OSUBB, de la 0 la 120.{' '}
              {text.applies}
            </p>
            <FieldError {...form.errorProps('months')} />
          </div>
          <div {...form.slot('enabled')}>
            <SwitchRow
              label="Regula este pornită"
              description={enabled ? text.on : text.off}
              checked={enabled}
              disabled={busy}
              onCheckedChange={(next) => setEnabled(next)}
            />
            <FieldError {...form.errorProps('enabled')} />
          </div>
          <FieldError>{form.formError}</FieldError>
          <div className="flex flex-wrap gap-2">
            <EditorActions
              disabled={busy}
              canSave={changed}
              onCancel={() => setEditing(false)}
            />
          </div>
        </form>
      )}
    </SettingRow>
  );
}

/** The Promotion Rules of one place on the tab, each a `RuleRow`. */
function RuleRows({
  rules,
  changes,
  identities,
  disabled,
  onRun,
}: {
  rules: readonly PromotionRule[];
  changes: readonly ThresholdChange[] | undefined;
  identities: Identities;
  disabled: boolean;
  onRun: Run;
}) {
  return rules.map((rule) => (
    <RuleRow
      key={rule.id}
      rule={rule}
      lastChange={changes?.find(
        (change) => change.promotion_rule_id === rule.id,
      )}
      identities={identities}
      disabled={disabled}
      onRun={onRun}
    />
  ));
}

/** Whoever changed a threshold, a share or a rule, for the names beside them. */
function useChangeAuthors(changes: readonly ThresholdChange[] | undefined) {
  const memberIds = useMemo(
    () =>
      (changes ?? []).flatMap((change) =>
        change.changed_by ? [change.changed_by] : [],
      ),
    [changes],
  );
  return useMemberIdentities(memberIds).data;
}

/**
 * The chosen kind's numbers, and only its: the Promotion Threshold in force,
 * the share the next one is computed from and, for Voluntar Activ, the
 * Promotion Rule its candidates must meet. The other kind's are one tap away
 * on the page's Tip switch, never beside these.
 */
function ThresholdsPanel({
  kind,
  thresholds,
  evaluations,
  disabled,
  onRun,
}: {
  kind: RoleEvaluationKind;
  thresholds: readonly PromotionThreshold[];
  evaluations: readonly RoleEvaluation[];
  disabled: boolean;
  onRun: Run;
}) {
  const changes = useThresholdChanges();
  const percents = useEvaluationPercents();
  const rules = usePromotionRules();
  const identities = useChangeAuthors(changes.data);
  const runName = (id: number | null) =>
    evaluations.find((run) => run.id === id)?.name ?? '…';
  const kindRules = (rules.data ?? []).filter(
    (rule) => ruleEvaluationKind(rule) === kind,
  );

  return (
    <Panel
      title="Praguri"
      control={
        <InfoHint label="Despre praguri">
          Punctele de task cu care evaluarea compară membrii, procentul din
          clasament din care calculează pragul următor și vechimea cerută unui
          candidat la promovare.
        </InfoHint>
      }
    >
      {/* Keyed by kind: an editor left open does not follow the switch. */}
      <ul key={kind} className={rowListClass}>
        <ThresholdRow
          kind={kind}
          row={thresholds.find((row) => row.kind === kind)}
          source={changes.data?.find(
            (change) => change.kind === kind && change.field === 'threshold',
          )}
          runName={runName}
          identities={identities}
          disabled={disabled}
          onRun={onRun}
        />
        <PercentRow
          kind={kind}
          percent={percents.data?.find((row) => row.kind === kind)}
          identities={identities}
          disabled={disabled}
          onRun={onRun}
        />
        <RuleRows
          rules={kindRules}
          changes={changes.data}
          identities={identities}
          disabled={disabled}
          onRun={onRun}
        />
      </ul>
      {/* Only Voluntar Activ has a rule to wait for or to miss. */}
      {kind === 'voluntar_activ' &&
        (rules.isPending ? (
          <Loading label="Se încarcă regulile de promovare…" />
        ) : rules.isError ? (
          <ErrorState
            text="Nu am putut încărca regulile de promovare."
            onRetry={() => void rules.refetch()}
          />
        ) : null)}
    </Panel>
  );
}

/**
 * The Promotion Rules no Role Evaluation reads — Recrut → Voluntar, which the
 * daily job applies by tenure alone — the page's content under Vechime, the
 * Tip switch's third choice.
 */
function TenureRulesPanel({
  disabled,
  onRun,
}: {
  disabled: boolean;
  onRun: Run;
}) {
  const rules = usePromotionRules();
  const changes = useThresholdChanges();
  const identities = useChangeAuthors(changes.data);
  return (
    <Panel title="Promovare după vechime">
      {rules.isPending ? (
        <Loading label="Se încarcă regulile de promovare…" />
      ) : rules.isError ? (
        <ErrorState
          text="Nu am putut încărca regulile de promovare."
          onRetry={() => void rules.refetch()}
        />
      ) : (
        <ul className={rowListClass}>
          <RuleRows
            rules={rules.data.filter(
              (rule) => ruleEvaluationKind(rule) === null,
            )}
            changes={changes.data}
            identities={identities}
            disabled={disabled}
            onRun={onRun}
          />
        </ul>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------------ */
/* Istoricul modificărilor                                                   */
/* ------------------------------------------------------------------------ */

/** The log's subject: a kind (threshold, share) or a rule (tenure, on/off). */
function changeSubject(
  change: ThresholdChange,
  rules: readonly PromotionRule[] | undefined,
): string {
  if (change.promotion_rule_id !== null) {
    const rule = rules?.find((row) => row.id === change.promotion_rule_id);
    const name = rule ? ruleLabel(rule) : 'Regulă de promovare';
    return `${name} · ${change.field === 'enabled' ? 'stare' : 'vechime'}`;
  }
  const kind = change.kind ?? '';
  return `${KIND_LABEL[kind] ?? kind}${change.field === 'percent' ? ' · procent' : ''}`;
}

/** The log's rows: all of them, or only those of the given Promotion Rules. */
function tenureChanges(
  changes: readonly ThresholdChange[],
  ruleIds: ReadonlySet<number> | undefined,
): readonly ThresholdChange[] {
  if (!ruleIds) return changes;
  return changes.filter(
    (change) =>
      change.promotion_rule_id !== null &&
      ruleIds.has(change.promotion_rule_id),
  );
}

/** The log's before → after, in each value's own unit. */
function changeValues(change: ThresholdChange): string {
  switch (change.field) {
    case 'percent':
      return `${change.from_value ?? '—'} % → ${change.to_value} %`;
    case 'tenure':
      return `${change.from_value === null ? '—' : formatMonthCount(change.from_value)} → ${formatMonthCount(change.to_value)}`;
    case 'enabled': {
      const state = (value: number | null) =>
        value === 1 ? 'pornită' : 'oprită';
      return `${state(change.from_value)} → ${state(change.to_value)}`;
    }
    default:
      return `${
        change.from_value === null ? 'nesetat' : formatPoints(change.from_value)
      } → ${formatPoints(change.to_value)}`;
  }
}

/**
 * Every change of a threshold, a share or a rule, newest first — a record of
 * both kinds, each row naming its own. Under Vechime (`ruleIds`) it keeps to
 * the changes of those Promotion Rules. The page mounts it with the first
 * change it would show (B58).
 */
function ChangeLogPanel({
  evaluations,
  ruleIds,
}: {
  evaluations: readonly RoleEvaluation[];
  /** Only the changes of these Promotion Rules. */
  ruleIds?: ReadonlySet<number>;
}) {
  const changes = useThresholdChanges();
  // Shared through the query cache: the log names each rule.
  const rules = usePromotionRules();
  const identities = useChangeAuthors(changes.data);
  const runName = (id: number | null) =>
    evaluations.find((run) => run.id === id)?.name ?? '…';
  return (
    <Panel title="Istoricul modificărilor">
      {changes.isPending ? (
        <Loading label="Se încarcă istoricul modificărilor…" />
      ) : changes.isError ? (
        <ErrorState
          text="Nu am putut încărca istoricul modificărilor."
          onRetry={() => void changes.refetch()}
        />
      ) : (
        <ul
          className={cn(rowListClass, 'max-h-80 overflow-y-auto text-sm')}
          aria-label="Istoricul modificărilor"
        >
          {tenureChanges(changes.data, ruleIds).map((change) => (
            <li
              key={change.id}
              className="grid min-w-0 gap-0.5 py-2 first:pt-0 last:pb-0"
            >
              <span className="text-muted-foreground tabular-nums">
                {formatInstantDay(change.changed_at)} ·{' '}
                {changeSubject(change, rules.data)}
              </span>
              <span className="flex min-w-0 flex-wrap items-center gap-x-1.5">
                <span className="font-semibold tabular-nums">
                  {changeValues(change)}
                </span>
                <span aria-hidden="true" className="text-muted-foreground">
                  ·
                </span>
                {change.source === 'manual' && change.changed_by ? (
                  <Name memberId={change.changed_by} identities={identities} />
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
        variant="ghost"
        size="icon"
        disabled={disabled}
        onClick={() => reset(true)}
        aria-label={`Respinge: ${name}`}
        title="Respinge"
      >
        <UserX aria-hidden="true" />
      </Button>
      <DialogContent>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Respingi candidatul?</DialogTitle>
            <DialogDescription>
              {candidate.evaluationName === null
                ? 'Candidatul rămâne Voluntar. Respingerea ține până la următoarea evaluare Voluntar Activ: dacă la ea, sau după ea, are din nou cel puțin pragul, reapare în listă.'
                : `Candidatul rămâne Voluntar. Respingerea ține doar pentru evaluarea „${candidate.evaluationName}”: dacă după ea are din nou cel puțin pragul, reapare în listă.`}
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
            <Textarea
              id={reasonId}
              rows={3}
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
          Voluntari cu vechimea cerută și cel puțin pragul Voluntar Activ: de
          îndată ce ajung la prag, și la fiecare evaluare Voluntar Activ. Nimeni
          nu este promovat automat: BC decide în panoul de roluri.
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
                  {formatPointCount(candidate.taskPoints)} · pragul{' '}
                  {formatPoints(candidate.thresholdUsed)} · vechime din{' '}
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

/* ------------------------------------------------------------------------ */
/* Semnale de retenție                                                       */
/* ------------------------------------------------------------------------ */

/**
 * The Retention Signals of the chosen kind's latest run: its holders under
 * the threshold that run used. The other kind's are behind the Tip switch.
 */
function SignalsPanel({
  kind,
  run,
}: {
  kind: RoleEvaluationKind;
  run: RoleEvaluation | undefined;
}) {
  const ranking = useRoleEvaluationRanking(run);
  const signals = useMemo(
    () => (run && ranking.data ? retentionSignals(run, ranking.data) : []),
    [run, ranking.data],
  );
  const identities = useMemberIdentities(
    signals.map((signal) => signal.memberId),
  );
  return (
    <Panel
      title="Semnale de retenție"
      control={
        <InfoHint label="Despre semnalele de retenție">
          Deținătorii rolului sub pragul folosit la ultima evaluare de acest
          tip. Retragerea unui rol este decizia BC, din panoul de roluri.
        </InfoHint>
      }
      stack={2}
    >
      {run && (
        <p className="m-0 text-sm text-muted-foreground tabular-nums">
          {run.name} · {rangeText(run)} · pragul{' '}
          {formatPoints(run.threshold_used)}
        </p>
      )}
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

/**
 * The viewport from which the history is a table (Tailwind's `xl`): its seven
 * columns need about 900 px, which the page has beside the sidebar only from
 * 1280 px. Under it each run is a list row, so nothing scrolls sideways.
 */
const HISTORY_TABLE_FROM = '80rem';

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
  const table = useMinWidth(HISTORY_TABLE_FROM);
  return (
    <Panel title="Istoricul evaluărilor">
      {/* Mounted only once a run exists (B58). */}
      {table ? (
        <DataTable
          columns={columns}
          data={rows}
          emptyTitle="Nicio evaluare de rol încă."
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
                {KIND_LABEL[run.kind] ?? run.kind} · {rangeText(run)}
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
                Prag folosit {formatPoints(run.threshold_used)} · prag calculat{' '}
                {computedThresholdText(run.threshold_computed)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * Administrare → **Evaluări de rol** (#827; ruling R28, over #826): BC or the
 * Moderator runs a Role Evaluation of one kind over an Evaluation Period,
 * edits that kind's Promotion Threshold and share, decides the Promotion
 * Candidates (promotion itself stays in the Role panel), reads the kind's
 * Retention Signals, and the history of runs and of changes.
 *
 * One **Tip** switch at the top drives the page: the run form, the numbers in
 * Praguri and the results below are the chosen kind's, never both kinds' side
 * by side. Promotion Candidates exist for Voluntar Activ only. Its third
 * choice, **Vechime**, is the promotion no evaluation runs: the Recrut →
 * Voluntar rule and that rule's changes, with nothing of either kind beside
 * them. The two histories stay put under either kind. Mounted behind
 * `manageRoles`; every command decides again on the server (level 6).
 */
export default function RoleEvaluationsScreen() {
  const evaluations = useRoleEvaluations();
  const thresholds = usePromotionThresholds();
  // Read here too, so the page decides whether the log has a panel (B58).
  const changes = useThresholdChanges();
  // Shared through the query cache: which changes are the tenure rules'.
  const rules = usePromotionRules();
  const command = useRoleEvaluationCommand();
  const run: Run = (next) => command.mutateAsync(next);
  const [view, setView] = useState<View>('voluntar_activ');
  // The kind last looked at: its panels stay mounted, hidden, under Vechime,
  // so a run's receipt or a half-written form is there on the way back.
  const [kind, setKind] = useState<RoleEvaluationKind>('voluntar_activ');
  const tenure = view === TENURE_VIEW;
  const tenureRuleIds = useMemo(
    () =>
      new Set(
        (rules.data ?? [])
          .filter((rule) => ruleEvaluationKind(rule) === null)
          .map((rule) => rule.id),
      ),
    [rules.data],
  );

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
  const hasLog = changes.isError || (changes.data?.length ?? 0) > 0;
  const hasTenureLog =
    changes.isError ||
    tenureChanges(changes.data ?? [], tenureRuleIds).length > 0;
  return (
    <ReceiptTurnScope>
      {/* A choice of three, drawn as segments; a long label wraps inside its
          segment, never past it (F-22). */}
      <SegmentedRadio<View>
        aria-label="Tip"
        className="sm:max-w-xl"
        options={[
          ...KINDS.map((value) => ({ value, label: KIND_LABEL[value] })),
          { value: TENURE_VIEW, label: TENURE_VIEW_LABEL },
        ]}
        value={view}
        onValueChange={(next) => {
          setView(next);
          if (next !== TENURE_VIEW) setKind(next);
        }}
        disabled={command.isPending}
      />
      {tenure && (
        <PageGrid columns={1}>
          <TenureRulesPanel disabled={command.isPending} onRun={run} />
          {hasTenureLog && (
            <ChangeLogPanel
              evaluations={evaluations.data}
              ruleIds={tenureRuleIds}
            />
          )}
        </PageGrid>
      )}
      {/* `contents`: the kind's grids stay the page's own blocks. */}
      <div hidden={tenure} className={tenure ? undefined : 'contents'}>
        <KindView
          kind={kind}
          evaluations={evaluations.data}
          thresholds={thresholds.data}
          hasLog={hasLog}
          disabled={command.isPending}
          onRun={run}
        />
      </div>
    </ReceiptTurnScope>
  );
}

/** What the page shows under one Role Evaluation kind. */
function KindView({
  kind,
  evaluations,
  thresholds,
  hasLog,
  disabled,
  onRun,
}: {
  kind: RoleEvaluationKind;
  evaluations: readonly RoleEvaluation[];
  thresholds: readonly PromotionThreshold[];
  hasLog: boolean;
  disabled: boolean;
  onRun: Run;
}) {
  // Until the first run only Run and Praguri have anything to say (B58): the
  // candidates, signals and history panels appear with their first row, the
  // log with its first change.
  const hasRun = evaluations.length > 0;
  return (
    <>
      <PageGrid columns={2} alignHeaders>
        <RunPanel
          kind={kind}
          evaluations={evaluations}
          thresholds={thresholds}
          disabled={disabled}
          onRun={onRun}
        />
        <ThresholdsPanel
          kind={kind}
          thresholds={thresholds}
          evaluations={evaluations}
          disabled={disabled}
          onRun={onRun}
        />
      </PageGrid>
      <PageGrid columns={1}>
        {/* Under both kinds: a promotion waits for a decision whichever
            evaluation the viewer is looking at. */}
        {hasRun && <CandidatesPanel disabled={disabled} onRun={onRun} />}
        {hasRun && (
          <SignalsPanel
            // Keyed by kind: one kind's rows never linger under the other.
            key={kind}
            kind={kind}
            run={latestRun(evaluations, kind)}
          />
        )}
        {hasRun && <HistoryPanel evaluations={evaluations} />}
        {hasLog && <ChangeLogPanel evaluations={evaluations} />}
      </PageGrid>
    </>
  );
}
