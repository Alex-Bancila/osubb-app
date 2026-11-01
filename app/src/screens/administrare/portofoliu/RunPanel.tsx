import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { Link } from 'react-router';
import { Panel } from '../../../components/layout';
import { ErrorState, Loading } from '../../../components/states';
import { Button } from '../../../components/ui/button';
import { DatePicker } from '../../../components/ui/date-picker';
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
import { Input } from '../../../components/ui/input';
import { bucharestDayKey } from '../../../lib/calendar-time';
import { describeFailure, reasonCopy } from '../../../lib/command-reasons';
import { formatDay, formatPointCount } from '../../../lib/format';
import {
  runFieldForReason,
  runSchema,
  simulationSchema,
  type RoleEvaluationKind,
} from '../../../lib/schemas/role-evaluation';
import { useFormValidation } from '../../../lib/use-form-validation';
import {
  useEvaluationSettings,
  type EvaluationSettings,
} from '../../../queries/evaluation-settings';
import {
  latestRun,
  simulateRoleEvaluation,
  simulationOutcome,
  type RoleEvaluation,
} from '../../../queries/role-evaluations';
import { useReceiptTurn } from '../../tracker/receipt-turn';
import {
  defaultRangeStart,
  finalizeConsequences,
  KIND_LABEL,
  previousDay,
  rangeText,
  runResultText,
  SIMULATION_NOTE,
  SIMULATION_STALE,
  SIMULATION_STALE_AG,
} from './portofoliu-text';
import { SETARI_HREF } from './portofoliu-view';
import {
  type DraftUpdate,
  type Edits,
  type FormValues,
  type RunDraft,
  type Simulated,
} from './run-draft';
import { SimulationResult } from './SimulationResult';
import { type RunCommand } from './shared';

/**
 * The refusals that are about a setting, not a field of the form: the way to
 * Setări goes beside them.
 */
const SETTING_REFUSALS: ReadonlySet<string> = new Set([
  'invalid_eligibility_floor',
  'invalid_membership_cutoff',
  'membership_cutoff_not_set',
]);

function isSettingRefusal(failure: unknown) {
  const { reason } = describeFailure(failure, '');
  return reason !== undefined && SETTING_REFUSALS.has(reason);
}

/** The kind's Procent in force in Setări. */
function shareInForce(settings: EvaluationSettings, kind: RoleEvaluationKind) {
  return kind === 'voluntar_activ'
    ? settings.activPercent
    : settings.votPercent;
}

/** The way to the setting a run needs: Setări, the page's own view. */
function SettingsLink() {
  return (
    <Link
      to={SETARI_HREF}
      className="inline-flex min-h-11 items-center rounded-sm text-sm font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring"
    >
      Deschide Setări
    </Link>
  );
}

/**
 * Rulează o evaluare (R58): the form of a run — the period, the kind's
 * **Procent** (prefilled from the settings in force) and the name — then
 * **Simulează**, the ranking such a run would produce, written nowhere, and
 * only then **Finalizează**, which asks once more, naming the consequences,
 * and records the run with the very values the Simulation used.
 * **Modifică valorile** goes back to the form with everything as typed.
 *
 * The **Prag minim** and, for Voluntar Activ, the **Data limită de intrare**
 * are not on the form: a Simulation and a run use the ones in force, which BC
 * edits only in Setări. The result card still names them, read-only. Finalizează
 * records the values the Simulation used, so if Setări changes after it (the
 * Prag minim, the cutoff, or the kind's Procent in force) the run would
 * disagree with Setări: the card says so and Finalizează waits for a new
 * Simulation. A Procent typed in the form that differs from Setări is the
 * member's choice, not a change.
 *
 * The name belongs to the run, not to the Simulation: **Simulează** checks
 * every field but **Nume**, **Finalizează** needs it.
 */
export function RunPanel({
  kind,
  draft,
  onDraft,
  simulating,
  onSimulating,
  evaluations,
  disabled,
  onRun,
}: {
  /** The page's section: the kind this run is of. */
  kind: RoleEvaluationKind;
  /**
   * What was typed and the Simulation shown, kept by the page for this kind:
   * leaving for Setări and coming back finds the form as it was left.
   */
  draft: RunDraft;
  onDraft: (update: DraftUpdate) => void;
  /** A Simulation is on its way; the page keeps its switch still meanwhile. */
  simulating: boolean;
  onSimulating: (simulating: boolean) => void;
  evaluations: readonly RoleEvaluation[];
  disabled: boolean;
  onRun: RunCommand;
}) {
  const fromId = useId();
  const toId = useId();
  const toHintId = useId();
  const nameId = useId();
  const percentId = useId();
  const blockedId = useId();
  const staleId = useId();
  const today = bucharestDayKey(new Date()) ?? '';
  // The last day a run may end (#1131: complete days only).
  const yesterday = today ? previousDay(today) : '';
  const settings = useEvaluationSettings();
  const data = settings.data;
  const { edits, simulated } = draft;
  const setEdits = (update: (previous: Edits) => Edits) =>
    onDraft((previous) => ({ ...previous, edits: update(previous.edits) }));
  const setSimulated = (next: Simulated | null) =>
    onDraft((previous) => ({ ...previous, simulated: next }));
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // The last refusal was about a setting: Setări is where it is mended.
  const [settingRefused, setSettingRefused] = useState(false);
  // One receipt at a time across the page (F-11).
  const turn = useReceiptTurn();
  // Where focus goes once the view that had it is gone: the result's line
  // after Simulează, the first field after Modifică valorile, the receipt
  // after a finished run.
  const lineRef = useRef<HTMLParagraphElement>(null);
  const receiptRef = useRef<HTMLParagraphElement>(null);
  const focusNext = useRef<'line' | 'field' | 'receipt' | null>(null);
  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    if (target === 'line') lineRef.current?.focus();
    else if (target === 'field') document.getElementById(fromId)?.focus();
    else receiptRef.current?.focus();
  });

  // "De la" starts the day after the kind's last range, never after yesterday;
  // "Până la" is yesterday -- a run covers complete days, and today's later
  // awards belong to the next period (#1131). The Procent is the kind's share
  // in force, until typed over.
  const live: FormValues = {
    kind,
    from:
      edits.from ??
      defaultRangeStart(latestRun(evaluations, kind)?.period_to, yesterday),
    to: edits.to ?? yesterday,
    name: edits.name ?? '',
    percent: edits.percent ?? String(data ? shareInForce(data, kind) : ''),
  };
  // Once a Simulation is shown only the name can still change: the run is of
  // the values it used, whatever the settings do meanwhile.
  const input: FormValues = simulated
    ? { ...simulated.input, name: live.name }
    : live;
  // The Prag minim and, for Voluntar Activ, the Data limită de intrare in
  // force: what a Simulation uses. Once one is shown, the run is of the ones
  // it used.
  const floor = simulated
    ? simulated.values.floor
    : (data?.eligibilityFloor ?? null);
  const cutoff = simulated
    ? simulated.values.cutoff
    : (data?.membershipCutoff ?? null);
  const simulation = useMemo(
    () => simulationSchema(today, { floor, cutoff }),
    [today, floor, cutoff],
  );
  const run = useMemo(
    () => runSchema(today, { floor, cutoff }),
    [today, floor, cutoff],
  );
  const form = useFormValidation(
    simulated ? run : simulation,
    input,
    runFieldForReason,
  );
  const fromField = form.field('from');
  const toField = form.field('to', toHintId);

  // Another kind on the page's switch: its own draft comes in with the props,
  // and nothing is said about the kind before it.
  const [shownKind, setShownKind] = useState(kind);
  if (shownKind !== kind) {
    setShownKind(kind);
    setConfirming(false);
    setMessage(null);
    setSettingRefused(false);
    form.reset();
  }

  const edit = (key: keyof Edits) => (value: string) =>
    setEdits((previous) => ({ ...previous, [key]: value }));

  // A Simulation reads the Prag minim and, for Voluntar Activ, the cutoff in
  // force; a run needs the same. Until BC has set them in Setări there is
  // nothing to simulate.
  const floorUnset = data !== undefined && data.eligibilityFloor === null;
  const cutoffUnset =
    kind === 'voluntar_activ' &&
    data !== undefined &&
    data.membershipCutoff === null;
  const blocked = floorUnset
    ? reasonCopy('eligibility_floor_not_set')
    : cutoffUnset
      ? reasonCopy('membership_cutoff_not_set')
      : undefined;
  // Setări has changed since the Simulation shown (a live update, another BC
  // member, a visit to Setări): the Prag minim, for Voluntar Activ the Data
  // limită de intrare, or the kind's Procent in force. The card keeps what it
  // simulated, and Finalizează waits.
  const stale =
    simulated !== null &&
    data !== undefined &&
    (simulated.values.floor !== data.eligibilityFloor ||
      (simulated.values.kind === 'voluntar_activ' &&
        simulated.values.cutoff !== data.membershipCutoff) ||
      simulated.shareInForce !== shareInForce(data, simulated.values.kind));
  // A confirmation of values that went stale is closed, never answered.
  if (stale && confirming) setConfirming(false);

  async function simulate(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    setSettingRefused(false);
    if (!form.validate() || data === undefined) return;
    // The Simulation writes nothing and has no name.
    const values = simulation.parse(input);
    onSimulating(true);
    try {
      const rows = await simulateRoleEvaluation(values);
      form.reset();
      setSimulated({
        values,
        input,
        rows,
        shareInForce: shareInForce(data, values.kind),
      });
      focusNext.current = 'line';
    } catch (failure) {
      form.fail(failure, 'Nu am putut simula evaluarea. Reîncearcă.');
      setSettingRefused(isSettingRefusal(failure));
    } finally {
      onSimulating(false);
    }
  }

  function backToForm() {
    focusNext.current = 'field';
    setSimulated(null);
    setConfirming(false);
    setSettingRefused(false);
    form.reset();
  }

  function review() {
    if (stale) return;
    if (form.validate()) setConfirming(true);
  }

  async function confirm() {
    if (!simulated || stale) return;
    // The run schema holds the settings the Simulation used.
    const parsed = run.safeParse(input);
    if (!parsed.success) return;
    setSettingRefused(false);
    try {
      const result = await onRun({ kind: 'run', values: parsed.data });
      setConfirming(false);
      setMessage(
        runResultText({
          kind: parsed.data.kind,
          name: parsed.data.name,
          candidates: result?.candidates ?? 0,
          retentionSignals: result?.retentionSignals ?? 0,
        }),
      );
      turn.claim();
      focusNext.current = 'receipt';
      // The next run starts from the settings this one just set.
      setSimulated(null);
      setEdits(() => ({}));
      form.reset();
    } catch (failure) {
      setConfirming(false);
      form.fail(failure, 'Nu am putut rula evaluarea. Reîncearcă.');
      setSettingRefused(isSettingRefusal(failure));
    }
  }

  const formError = (
    <>
      <FieldError>{form.formError}</FieldError>
      {settingRefused && form.formError && <SettingsLink />}
    </>
  );

  const named = run.safeParse(input);
  const line = simulated
    ? simulationOutcome(simulated.rows, simulated.values.kind).line
    : null;

  const nameField = (
    <div className="grid min-w-0 content-start gap-1.5">
      <label htmlFor={nameId} className="text-sm font-medium">
        Nume
      </label>
      <Input
        id={nameId}
        aria-label="Nume"
        value={live.name}
        required
        placeholder="Toamna 2026"
        disabled={disabled}
        onChange={(event) => edit('name')(event.target.value)}
        {...form.field('name')}
      />
      <FieldError {...form.errorProps('name')} />
    </div>
  );

  return (
    <Panel
      title="Rulează o evaluare"
      control={
        <InfoHint label="Despre evaluare">
          Clasează punctele de task dintr-un interval ales acum. Simularea nu
          salvează nimic, iar evaluarea finalizată nu schimbă niciun rol.
        </InfoHint>
      }
    >
      {settings.isPending ? (
        <Loading label="Se încarcă setările…" />
      ) : settings.isError ? (
        <ErrorState
          text="Nu am putut încărca setările evaluărilor."
          onRetry={() => void settings.refetch()}
        />
      ) : simulated ? (
        <div className="grid min-w-0 gap-4">
          <p className="m-0 text-sm font-medium">{SIMULATION_NOTE}</p>
          <p className="m-0 text-sm text-muted-foreground tabular-nums">
            {KIND_LABEL[simulated.values.kind]} ·{' '}
            {rangeText({
              period_from: simulated.values.from,
              period_to: simulated.values.to,
            })}{' '}
            · Prag minim {formatPointCount(simulated.values.floor)} · Procent{' '}
            {simulated.values.percent} %
            {simulated.values.cutoff &&
              ` · Data limită de intrare ${formatDay(simulated.values.cutoff)}`}
          </p>
          <SimulationResult
            kind={simulated.values.kind}
            floor={simulated.values.floor}
            rows={simulated.rows}
            lineRef={lineRef}
          />
          <div className="max-w-md">{nameField}</div>
          {formError}
          <FieldError id={staleId}>
            {stale
              ? simulated?.values.kind === 'voluntar_activ'
                ? SIMULATION_STALE
                : SIMULATION_STALE_AG
              : null}
          </FieldError>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={disabled || stale}
              aria-describedby={stale ? staleId : undefined}
              onClick={review}
            >
              Finalizează
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={backToForm}
            >
              Modifică valorile
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={simulate} noValidate className="grid gap-4">
          {/* Two rows from 640 px, De la · Până la and Procent · Nume; one column
              under it. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid min-w-0 content-start gap-1.5">
              <label htmlFor={fromId} className="text-sm font-medium">
                De la
              </label>
              <DatePicker
                id={fromId}
                value={live.from}
                required
                max={yesterday}
                disabled={disabled}
                onChange={edit('from')}
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
                value={live.to}
                required
                max={yesterday}
                disabled={disabled}
                onChange={edit('to')}
                {...toField}
              />
              {/* #1131: why the period ends yesterday at the latest. */}
              <p id={toHintId} className="m-0 text-sm text-muted-foreground">
                Ziua de azi intră în următoarea perioadă.
              </p>
              <FieldError {...form.errorProps('to')} />
            </div>
            <div className="grid min-w-0 content-start gap-1.5">
              <label htmlFor={percentId} className="text-sm font-medium">
                Procent
              </label>
              <div className="relative">
                <Input
                  id={percentId}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={100}
                  step={1}
                  className="pr-9"
                  value={live.percent}
                  required
                  disabled={disabled}
                  onChange={(event) => edit('percent')(event.target.value)}
                  {...form.field('percent')}
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground"
                >
                  %
                </span>
              </div>
              <FieldError {...form.errorProps('percent')} />
            </div>
            {nameField}
          </div>
          {formError}
          <div className="grid gap-2">
            <Button
              type="submit"
              className="w-full sm:w-auto sm:justify-self-start"
              disabled={disabled || simulating || blocked !== undefined}
              aria-describedby={blocked !== undefined ? blockedId : undefined}
            >
              {simulating ? 'Se simulează…' : 'Simulează'}
            </Button>
            {blocked !== undefined && (
              <p className="m-0 flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
                <span id={blockedId}>{blocked}</span>
                <SettingsLink />
              </p>
            )}
          </div>
        </form>
      )}
      {/* One live region for the whole panel, mounted before anything is said
          in it, so a screen reader announces the receipt when it arrives. */}
      <div role="status">
        {message && turn.current && (
          <p
            ref={receiptRef}
            tabIndex={-1}
            className="m-0 mt-4 text-sm font-medium outline-none"
          >
            {message}
          </p>
        )}
      </div>
      <Dialog
        open={confirming}
        onOpenChange={(next) => !disabled && setConfirming(next)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {`Finalizezi evaluarea „${named.success ? named.data.name : live.name}”?`}
            </DialogTitle>
            <DialogDescription>
              {simulated
                ? finalizeConsequences({ ...simulated.values, line })
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
              disabled={disabled || stale}
              onClick={() => void confirm()}
            >
              Finalizează
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
