import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { Pencil, UserX } from 'lucide-react';
import { cn } from 'cn';
import { SubHeading } from '../../../components/layout';
import { MemberName } from '../../../components/member/MemberName';
import type { MemberIdentity } from '../../../components/member/member-identity';
import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { FieldError } from '../../../components/ui/field';
import { InfoHint } from '../../../components/ui/info-hint';
import { Input, Textarea } from '../../../components/ui/input';
import { describeFailure } from '../../../lib/command-reasons';
import { formatPointCount, formatPoints } from '../../../lib/format';
import {
  percentFieldForReason,
  percentSchema,
  rejectionFieldForReason,
  rejectionSchema,
  thresholdFieldForReason,
  thresholdSchema,
  type RoleEvaluationKind,
} from '../../../lib/schemas/role-evaluation';
import { useFormValidation } from '../../../lib/use-form-validation';
import { useMemberIdentities } from '../../../queries/member-identities';
import type {
  PromotionCandidate,
  PromotionThreshold,
  RoleEvaluation,
  RoleEvaluationCommand,
  RunResult,
  ThresholdChange,
} from '../../../queries/role-evaluations';
import { useReceiptTurn } from '../../tracker/receipt-turn';
import {
  PERCENT_LABEL,
  runNameOf,
  STALE_CANDIDATE,
  THRESHOLD_LABEL,
} from './portofoliu-text';

/** What the page asks of the Role Evaluation commands (run, threshold, share, reject). */
export type RunCommand = (
  command: RoleEvaluationCommand,
) => Promise<RunResult | null>;

export type Identities = Map<string, MemberIdentity> | undefined;

/** A name button for a Member the identities read may not have answered yet. */
export function Name({
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

/** Whoever changed a threshold, a share or a setting, for the names beside them. */
// oxlint-disable-next-line react/only-export-components
export function useChangeAuthors(
  changes: readonly ThresholdChange[] | undefined,
) {
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
 * Who made a change, in a sentence under its setting: a Member by name, a
 * run by its name, a migration as such. `lead` is the verb ("schimbat").
 */
export function ChangeNote({
  change,
  evaluations,
  identities,
}: {
  change: ThresholdChange;
  evaluations: readonly RoleEvaluation[];
  identities: Identities;
}) {
  return (
    <p className="m-0 flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground">
      {change.source === 'manual' && change.changed_by ? (
        <>
          schimbat de
          <Name memberId={change.changed_by} identities={identities} />
        </>
      ) : change.source === 'migration' ? (
        <>schimbat prin migrare</>
      ) : (
        <>
          schimbat de evaluarea „
          {runNameOf(evaluations, change.role_evaluation_id)}”
        </>
      )}
    </p>
  );
}

/**
 * Where focus goes around an in-place editor: to its field when it opens,
 * back to the pencil that opened it when it closes (#923).
 */
// oxlint-disable-next-line react/only-export-components
export function useEditorFocus(editing: boolean, fieldId: string) {
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
 * One setting of the page, as a row: its name (with an "i" for what it needs
 * said once), the value in force at the right in tabular figures, and its
 * controls — a pencil. What belongs under the row (where the value came from,
 * the editor, the receipt) follows as children.
 */
export function SettingRow({
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
export function EditorActions({
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

/** The pencil that opens a row's editor. */
export function EditButton({
  label,
  disabled,
  onClick,
  buttonRef,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  buttonRef: Ref<HTMLButtonElement>;
}) {
  return (
    <Button
      ref={buttonRef}
      type="button"
      variant="outline"
      size="icon"
      disabled={disabled}
      onClick={onClick}
      aria-label={`Editează ${label}`}
      title={`Editează ${label}`}
    >
      <Pencil aria-hidden="true" />
    </Button>
  );
}

/** What a saved setting says once, until another control claims the turn. */
export function Receipt({
  message,
  current,
}: {
  message: string | null;
  current: boolean;
}) {
  return message && current ? (
    <p role="status" className="m-0 text-sm font-medium">
      {message}
    </p>
  ) : null;
}

/**
 * A kind's top share (#866, ruling R30; held in the settings since R58): the
 * row under the thresholds, edited in place — a whole 1–100 with the percent
 * sign fixed inside the field, so BC types only the number.
 */
export function PercentRow({
  kind,
  percent,
  change,
  evaluations,
  identities,
  disabled,
  onRun,
}: {
  kind: RoleEvaluationKind;
  percent: number | null;
  /** The share's last change in the log, if it has one. */
  change: ThresholdChange | undefined;
  evaluations: readonly RoleEvaluation[];
  identities: Identities;
  disabled: boolean;
  onRun: RunCommand;
}) {
  const labelId = useId();
  const inputId = useId();
  const hintId = useId();
  const label = PERCENT_LABEL[kind];
  const threshold = THRESHOLD_LABEL[kind];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const editButton = useEditorFocus(editing, inputId);
  // One receipt at a time across the page (F-11).
  const turn = useReceiptTurn();
  const form = useFormValidation(
    percentSchema,
    { percent: draft },
    percentFieldForReason,
  );
  // The hint follows what BC types while it is a valid share.
  const typed = percentSchema.safeParse({ percent: draft });
  const shown = typed.success ? typed.data.percent : (percent ?? 'x');

  function open() {
    setDraft(percent === null ? '' : String(percent));
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
            {`${threshold} calculat este punctajul ultimului membru din primii ${percent ?? 'x'} % dintre membrii clasați.`}
          </InfoHint>
        )
      }
      value={percent === null ? '—' : `${percent} %`}
      controls={
        !editing && (
          <EditButton
            buttonRef={editButton}
            label={label}
            disabled={disabled}
            onClick={open}
          />
        )
      }
    >
      {change && !editing && (
        <ChangeNote
          change={change}
          evaluations={evaluations}
          identities={identities}
        />
      )}
      {editing && (
        // The row's name, right above, is the field's label.
        <form onSubmit={save} noValidate className="grid gap-1.5">
          <div className="flex min-w-0 flex-wrap gap-2">
            <div className="relative w-28 flex-none">
              <Input
                id={inputId}
                aria-label={`Valoare nouă pentru ${label}`}
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
            {`Un număr întreg de la 1 la 100. ${threshold} calculat este punctajul ultimului membru din primii ${shown} % dintre membrii clasați. Se aplică de la următoarea evaluare; evaluările rulate nu se recalculează.`}
          </p>
          <FieldError {...form.errorProps('percent')} />
          <FieldError>{form.formError}</FieldError>
        </form>
      )}
      <Receipt message={message} current={turn.current} />
    </SettingRow>
  );
}

/**
 * A kind's Promotion Threshold in force, still hand-editable (R58): the line
 * the live Candidates are read against until the kind's next run computes a
 * new one.
 */
export function ThresholdRow({
  kind,
  row,
  source,
  evaluations,
  identities,
  disabled,
  onRun,
}: {
  kind: RoleEvaluationKind;
  row: PromotionThreshold | undefined;
  /** The kind's latest threshold change: where the value in force came from. */
  source: ThresholdChange | undefined;
  evaluations: readonly RoleEvaluation[];
  identities: Identities;
  disabled: boolean;
  onRun: RunCommand;
}) {
  const labelId = useId();
  const inputId = useId();
  const hintId = useId();
  const label = THRESHOLD_LABEL[kind];
  const current = row?.threshold ?? null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const editButton = useEditorFocus(editing, inputId);
  // One receipt at a time across the page (F-11).
  const turn = useReceiptTurn();
  const form = useFormValidation(
    thresholdSchema,
    { threshold: draft },
    thresholdFieldForReason,
  );
  const explained =
    'Puncte de task. Dacă îl schimbi, lista candidaților se actualizează îndată; următoarea evaluare de acest tip calculează unul nou și îl pune în vigoare.';

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
        !editing && <InfoHint label={`Despre ${label}`}>{explained}</InfoHint>
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
          <EditButton
            buttonRef={editButton}
            label={label}
            disabled={disabled}
            onClick={open}
          />
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
          ) : source.source === 'migration' ? (
            <>setat prin migrare</>
          ) : (
            <>
              calculat de evaluarea „
              {runNameOf(evaluations, source.role_evaluation_id)}”
            </>
          )}
        </p>
      )}
      {editing && (
        // The row's name, right above, is the field's label.
        <form onSubmit={save} noValidate className="grid gap-1.5">
          <div className="flex min-w-0 flex-wrap gap-2">
            <Input
              id={inputId}
              aria-label={`Valoare nouă pentru ${label}`}
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
            {explained}
          </p>
          <FieldError {...form.errorProps('threshold')} />
          <FieldError>{form.formError}</FieldError>
        </form>
      )}
      <Receipt message={message} current={turn.current} />
    </SettingRow>
  );
}

/** "Respinge", with the reason BC gives (at most 500 characters). */
export function RejectDialog({
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
  onRun: RunCommand;
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
                ? 'Candidatul rămâne Voluntar. Respingerea ține până la următoarea evaluare Voluntar Activ: dacă la ea, sau după ea, are din nou cel puțin pragul de promovare, reapare în listă.'
                : `Candidatul rămâne Voluntar. Respingerea ține doar pentru evaluarea „${candidate.evaluationName}”: dacă după ea are din nou cel puțin pragul de promovare, reapare în listă.`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm">
            <Name memberId={candidate.memberId} identities={identities} />
            <span className="text-muted-foreground tabular-nums">
              {formatPointCount(candidate.taskPoints)} · pragul de promovare{' '}
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
