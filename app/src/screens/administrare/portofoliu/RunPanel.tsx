import { useId, useMemo, useState, type FormEvent } from 'react';
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
import { reasonCopy } from '../../../lib/command-reasons';
import { formatDay, formatPointCount } from '../../../lib/format';
import {
  runFieldForReason,
  runSchema,
  simulationSchema,
  type RoleEvaluationKind,
} from '../../../lib/schemas/role-evaluation';
import { useFormValidation } from '../../../lib/use-form-validation';
import { useEvaluationSettings } from '../../../queries/evaluation-settings';
import {
  latestRun,
  simulateRoleEvaluation,
  simulationOutcome,
  type RankingRow,
  type RoleEvaluation,
} from '../../../queries/role-evaluations';
import { useReceiptTurn } from '../../tracker/receipt-turn';
import {
  defaultRangeStart,
  finalizeConsequences,
  KIND_LABEL,
  runResultText,
  SIMULATION_NOTE,
} from './portofoliu-text';
import { SimulationResult } from './SimulationResult';
import { rangeText, type RunCommand } from './shared';

/** What the member has typed over the values the settings prefill. */
type Edits = Partial<{
  from: string;
  to: string;
  name: string;
  floor: string;
  percent: string;
  cutoff: string;
}>;

/** The form as the fields hold it: text, until a schema reads it. */
type FormValues = {
  kind: RoleEvaluationKind;
  from: string;
  to: string;
  name: string;
  floor: string;
  percent: string;
  cutoff: string;
};

/** A Simulation shown: the values it used, the form they came from, its rows. */
type Simulated = {
  values: {
    kind: RoleEvaluationKind;
    from: string;
    to: string;
    floor: number;
    percent: number;
    cutoff: string | null;
  };
  input: FormValues;
  rows: RankingRow[];
};

/**
 * Rulează o evaluare (R58): the form of a run, prefilled from the settings in
 * force, then **Simulează** — the ranking such a run would produce, written
 * nowhere — and only then **Finalizează**, which asks once more, naming the
 * consequences, and records the run with the very values the Simulation used.
 * **Modifică valorile** goes back to the form with everything as typed.
 *
 * The name belongs to the run, not to the Simulation: **Simulează** checks
 * every field but **Nume**, **Finalizează** needs it.
 */
export function RunPanel({
  kind,
  evaluations,
  disabled,
  onRun,
}: {
  /** The page's Tip: the kind this run is of. */
  kind: RoleEvaluationKind;
  evaluations: readonly RoleEvaluation[];
  disabled: boolean;
  onRun: RunCommand;
}) {
  const fromId = useId();
  const toId = useId();
  const nameId = useId();
  const floorId = useId();
  const percentId = useId();
  const cutoffId = useId();
  const blockedId = useId();
  const today = bucharestDayKey(new Date()) ?? '';
  const settings = useEvaluationSettings();
  const data = settings.data;
  const [edits, setEdits] = useState<Edits>({});
  const [simulated, setSimulated] = useState<Simulated | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // One receipt at a time across the page (F-11).
  const turn = useReceiptTurn();

  // "De la" starts the day after the kind's last range, never after today;
  // "Până la" is today. The rest is what the settings hold, until typed over.
  const live: FormValues = {
    kind,
    from:
      edits.from ??
      defaultRangeStart(latestRun(evaluations, kind)?.period_to, today),
    to: edits.to ?? today,
    name: edits.name ?? '',
    floor: edits.floor ?? String(data?.eligibilityFloor ?? ''),
    percent:
      edits.percent ??
      String(
        (kind === 'voluntar_activ' ? data?.activPercent : data?.votPercent) ??
          '',
      ),
    cutoff: edits.cutoff ?? data?.membershipCutoff ?? '',
  };
  // Once a Simulation is shown only the name can still change: the run is of
  // the values it used, whatever the settings do meanwhile.
  const input: FormValues = simulated
    ? { ...simulated.input, name: live.name }
    : live;
  const simulation = useMemo(() => simulationSchema(today), [today]);
  const run = useMemo(() => runSchema(today), [today]);
  const form = useFormValidation(
    simulated ? run : simulation,
    input,
    runFieldForReason,
  );
  const fromField = form.field('from');
  const toField = form.field('to');
  const cutoffField = form.field('cutoff');

  // Another kind on the page's switch: its own "De la", share and cutoff, and
  // nothing said about the kind before it. The name, "Până la" and the Prag
  // minim stay as typed.
  const [shownKind, setShownKind] = useState(kind);
  if (shownKind !== kind) {
    setShownKind(kind);
    setEdits((previous) => ({
      to: previous.to,
      name: previous.name,
      floor: previous.floor,
    }));
    setSimulated(null);
    setMessage(null);
    form.reset();
  }

  const edit = (key: keyof Edits) => (value: string) =>
    setEdits((previous) => ({ ...previous, [key]: value }));

  // A Simulation reads the Prag minim and, for Voluntar Activ, the cutoff in
  // force; a run needs the same. Until BC has set them there is nothing to
  // simulate.
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

  async function simulate(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    if (!form.validate()) return;
    // The Simulation writes nothing and has no name.
    const values = simulation.parse(input);
    setSimulating(true);
    try {
      const rows = await simulateRoleEvaluation(values);
      form.reset();
      setSimulated({ values, input, rows });
    } catch (failure) {
      form.fail(failure, 'Nu am putut simula evaluarea. Reîncearcă.');
    } finally {
      setSimulating(false);
    }
  }

  function backToForm() {
    setSimulated(null);
    setConfirming(false);
    form.reset();
  }

  function review() {
    if (form.validate()) setConfirming(true);
  }

  async function confirm() {
    if (!simulated) return;
    const parsed = run.safeParse(input);
    if (!parsed.success) return;
    const values = { ...simulated.values, name: parsed.data.name };
    try {
      const result = await onRun({ kind: 'run', values });
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
      // The next run starts from the settings this one just set.
      setSimulated(null);
      setEdits({});
      form.reset();
    } catch (failure) {
      setConfirming(false);
      form.fail(failure, 'Nu am putut rula evaluarea. Reîncearcă.');
    }
  }

  const named = run.safeParse(input);
  const line = simulated
    ? simulationOutcome(simulated.rows, simulated.values.kind).line
    : null;

  const nameField = (
    <div className="grid gap-1.5">
      <label htmlFor={nameId} className="text-sm font-medium">
        Nume
      </label>
      <Input
        id={nameId}
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
          <p role="status" className="m-0 text-sm font-medium">
            {SIMULATION_NOTE}
          </p>
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
          />
          {nameField}
          <FieldError>{form.formError}</FieldError>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={disabled} onClick={review}>
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
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid min-w-0 content-start gap-1.5">
              <label htmlFor={fromId} className="text-sm font-medium">
                De la
              </label>
              <DatePicker
                id={fromId}
                value={live.from}
                required
                max={today}
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
                max={today}
                disabled={disabled}
                onChange={edit('to')}
                {...toField}
              />
              <FieldError {...form.errorProps('to')} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid min-w-0 content-start gap-1.5">
              <label htmlFor={floorId} className="text-sm font-medium">
                Prag minim
              </label>
              <Input
                id={floorId}
                inputMode="numeric"
                value={live.floor}
                required
                disabled={disabled}
                onChange={(event) => edit('floor')(event.target.value)}
                {...form.field('floor')}
              />
              <FieldError {...form.errorProps('floor')} />
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
          </div>
          {kind === 'voluntar_activ' && (
            <div className="grid min-w-0 content-start gap-1.5">
              <label htmlFor={cutoffId} className="text-sm font-medium">
                Data limită de intrare
              </label>
              <DatePicker
                id={cutoffId}
                value={live.cutoff}
                required
                max={today}
                disabled={disabled}
                onChange={edit('cutoff')}
                {...cutoffField}
              />
              <FieldError {...form.errorProps('cutoff')} />
            </div>
          )}
          {nameField}
          <FieldError>{form.formError}</FieldError>
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
              <p id={blockedId} className="m-0 text-sm text-muted-foreground">
                {blocked}
              </p>
            )}
          </div>
          {message && turn.current && (
            <p role="status" className="m-0 text-sm font-medium">
              {message}
            </p>
          )}
        </form>
      )}
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
              disabled={disabled}
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
