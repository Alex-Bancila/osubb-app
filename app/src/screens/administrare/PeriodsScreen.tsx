import { useId, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { cn } from 'cn';
import { MemberName } from '../../components/member/MemberName';
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
import { BUCHAREST_TIME_ZONE } from '../../lib/calendar-time';
import { describeFailure } from '../../lib/command-reasons';
import { formatPoints } from '../../lib/format';
import {
  adherenceFormFieldForReason,
  adherenceFormSchema,
  initialThresholdFieldForReason,
  initialThresholdSchema,
  periodNameFieldForReason,
  periodNameSchema,
} from '../../lib/schemas/evaluation-period';
import { useFormValidation } from '../../lib/use-form-validation';
import {
  lastClosedPeriod,
  openPeriod,
  thresholdSource,
  useEvaluationPeriods,
  useOrgSettings,
  usePeriodCommand,
  usePromotionThreshold,
  useRetentionSignals,
  type EvaluationPeriod,
  type PeriodCommand,
} from '../../queries/evaluation-periods';
import { useAdminGroups } from '../../queries/groups-admin';
import { useMemberIdentities } from '../../queries/member-identities';

const control =
  'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';
const card = 'space-y-3 rounded-xl border bg-card p-4 md:p-5';

const dayFormatter = new Intl.DateTimeFormat('ro-RO', {
  timeZone: BUCHAREST_TIME_ZONE,
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** `25 septembrie 2026`, the day in Romania whatever the device's zone. */
function formatDay(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : dayFormatter.format(date);
}

/** The two Roles a Retention Signal is about (#48). */
const ROLE_AT_RISK: Record<string, string> = {
  activ: 'Voluntar Activ',
  vot: 'Voluntar cu Drept de Vot',
};

type Run = (command: PeriodCommand) => Promise<void>;

/** The panel's cards all wait on the same read state before they show. */
function Loading({ label }: { label: string }) {
  return <p role="status">{label}</p>;
}

/* ------------------------------------------------------------------------ */
/* Perioada curentă                                                          */
/* ------------------------------------------------------------------------ */

function OpenPeriodDialog({
  disabled,
  onRun,
}: {
  disabled: boolean;
  onRun: Run;
}) {
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const form = useFormValidation(
    periodNameSchema,
    { name },
    periodNameFieldForReason,
  );

  function reset(next: boolean) {
    setOpen(next);
    if (next) {
      setName('');
      form.reset();
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const values = form.validate();
    if (!values) return;
    try {
      await onRun({ kind: 'open', name: values.name });
      setOpen(false);
    } catch (failure) {
      form.fail(failure, 'Nu am putut deschide perioada. Reîncearcă.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !disabled && reset(next)}>
      <Button type="button" disabled={disabled} onClick={() => reset(true)}>
        Deschide o perioadă
      </Button>
      <DialogContent>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Deschide o perioadă</DialogTitle>
            <DialogDescription>
              Punctele primite de acum până la închidere intră în clasamentul
              perioadei. Poate fi deschisă o singură perioadă odată.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <label htmlFor={inputId} className="text-sm font-medium">
              Numele perioadei
            </label>
            <input
              id={inputId}
              className={control}
              value={name}
              required
              disabled={disabled}
              onChange={(event) => setName(event.target.value)}
              {...form.field('name')}
            />
            <FieldError {...form.errorProps('name')} />
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
            <Button type="submit" disabled={disabled}>
              Deschide perioada
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ClosePeriodDialog({
  period,
  disabled,
  onRun,
}: {
  period: EvaluationPeriod;
  disabled: boolean;
  onRun: Run;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset(next: boolean) {
    setOpen(next);
    if (next) setError(null);
  }

  async function confirm() {
    setError(null);
    try {
      await onRun({ kind: 'close', periodId: period.id });
      setOpen(false);
    } catch (failure) {
      setError(
        describeFailure(failure, 'Nu am putut închide perioada. Reîncearcă.')
          .message,
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !disabled && reset(next)}>
      <Button
        type="button"
        variant="destructive"
        disabled={disabled}
        onClick={() => reset(true)}
      >
        Închide perioada
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Închizi perioada {period.name}?</DialogTitle>
          <DialogDescription>
            Închiderea nu se poate anula. În același pas:
          </DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>pragul de promovare se fixează din clasamentul perioadei;</li>
          <li>promovările de închidere se aplică;</li>
          <li>semnalele de retenție se trimit.</li>
        </ul>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => setOpen(false)}
          >
            Renunță
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={disabled}
            onClick={() => void confirm()}
          >
            Închide perioada
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CurrentPeriodCard({
  periods,
  disabled,
  onRun,
}: {
  periods: readonly EvaluationPeriod[];
  disabled: boolean;
  onRun: Run;
}) {
  const current = openPeriod(periods);
  return (
    <section aria-labelledby="period-current-title" className={card}>
      <h2 id="period-current-title" className="text-xl font-semibold">
        Perioada curentă
      </h2>
      {current ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p>
            <span className="font-semibold break-words">{current.name}</span>
            <span className="block text-sm text-muted-foreground">
              Deschisă din {formatDay(current.opened_at)}
            </span>
          </p>
          <ClosePeriodDialog
            key={current.id}
            period={current}
            disabled={disabled}
            onRun={onRun}
          />
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted-foreground">Nicio perioadă deschisă</p>
          <OpenPeriodDialog disabled={disabled} onRun={onRun} />
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------------ */
/* Prag de promovare                                                         */
/* ------------------------------------------------------------------------ */

function InitialThresholdForm({
  ruleId,
  initialThreshold,
  disabled,
  onRun,
}: {
  ruleId: number;
  initialThreshold: number;
  disabled: boolean;
  onRun: Run;
}) {
  const inputId = useId();
  const hintId = useId();
  const [threshold, setThreshold] = useState(String(initialThreshold));
  const form = useFormValidation(
    initialThresholdSchema,
    { threshold },
    initialThresholdFieldForReason,
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    const values = form.validate();
    if (!values) return;
    try {
      await onRun({
        kind: 'initialThreshold',
        ruleId,
        threshold: values.threshold,
      });
    } catch (failure) {
      form.fail(failure, 'Nu am putut salva pragul inițial. Reîncearcă.');
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid max-w-sm gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium">
        Prag inițial
      </label>
      <p id={hintId} className="text-sm text-muted-foreground">
        Puncte de task. Se poate schimba doar până la prima închidere a unei
        perioade.
      </p>
      <div className="flex gap-2">
        <input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          className={control}
          value={threshold}
          disabled={disabled}
          onChange={(event) => setThreshold(event.target.value)}
          {...form.field('threshold', hintId)}
        />
        <Button type="submit" disabled={disabled}>
          Salvează
        </Button>
      </div>
      <FieldError {...form.errorProps('threshold')} />
      <FieldError>{form.formError}</FieldError>
    </form>
  );
}

function ThresholdCard({
  periods,
  disabled,
  onRun,
}: {
  periods: readonly EvaluationPeriod[];
  disabled: boolean;
  onRun: Run;
}) {
  const threshold = usePromotionThreshold();
  const source = thresholdSource(periods);
  const anyClosed = periods.some((period) => period.closed_at !== null);
  return (
    <section aria-labelledby="period-threshold-title" className={card}>
      <h2 id="period-threshold-title" className="text-xl font-semibold">
        Prag de promovare
      </h2>
      {threshold.isPending ? (
        <Loading label="Se încarcă pragul…" />
      ) : threshold.isError ? (
        <p role="alert">Nu am putut încărca pragul de promovare.</p>
      ) : (
        <>
          <p>
            <span className="text-2xl font-bold tabular-nums">
              {threshold.data.inForce === null
                ? '—'
                : `${formatPoints(threshold.data.inForce)} puncte`}
            </span>
            <span className="block text-sm text-muted-foreground">
              {source ? `din perioada ${source.name}` : 'prag inițial'}
            </span>
          </p>
          {anyClosed ? (
            <p className="text-sm text-muted-foreground">
              Pragul vine acum din ultima închidere a unei perioade și nu se mai
              editează de mână.
            </p>
          ) : threshold.data.rule ? (
            <InitialThresholdForm
              key={threshold.data.rule.initialThreshold}
              ruleId={threshold.data.rule.id}
              initialThreshold={threshold.data.rule.initialThreshold}
              disabled={disabled}
              onRun={onRun}
            />
          ) : null}
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------------ */
/* Semnale de retenție                                                       */
/* ------------------------------------------------------------------------ */

function RetentionSignalsCard({
  periods,
}: {
  periods: readonly EvaluationPeriod[];
}) {
  const last = lastClosedPeriod(periods);
  const signals = useRetentionSignals(last?.id ?? null);
  const memberIds = useMemo(
    () => (signals.data ?? []).map((signal) => signal.memberId),
    [signals.data],
  );
  const identities = useMemberIdentities(memberIds);
  return (
    <section aria-labelledby="period-signals-title" className={card}>
      <div>
        <h2 id="period-signals-title" className="text-xl font-semibold">
          Semnale de retenție
        </h2>
        <p className="text-sm text-muted-foreground">
          {last
            ? `Membrii sub pragul rolului lor la închiderea perioadei ${last.name}. Retragerea unui rol este decizia BC, din panoul de roluri.`
            : 'Membrii sub pragul rolului lor la ultima închidere.'}
        </p>
      </div>
      {!last ? (
        <p className="text-muted-foreground">Nicio perioadă închisă încă</p>
      ) : signals.isPending ? (
        <Loading label="Se încarcă semnalele…" />
      ) : signals.isError ? (
        <p role="alert">Nu am putut încărca semnalele de retenție.</p>
      ) : signals.data.length === 0 ? (
        <p className="text-muted-foreground">
          Niciun semnal la ultima închidere
        </p>
      ) : (
        <ul className="divide-y" aria-label="Semnale de retenție">
          {signals.data.map((signal) => {
            const identity = identities.data?.get(signal.memberId);
            const fullName = identity?.fullName ?? 'Membru OSUBB';
            const shown = identity?.nickname?.trim() || fullName;
            return (
              <li
                key={`${signal.role}:${signal.memberId}`}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <span className="grid min-w-0 gap-0.5">
                  <MemberName
                    size="sm"
                    memberId={signal.memberId}
                    nickname={identity?.nickname}
                    fullName={fullName}
                    avatarColor={identity?.avatarColor}
                  />
                  <span className="text-sm text-muted-foreground">
                    {ROLE_AT_RISK[signal.role] ?? signal.role} ·{' '}
                    {formatPoints(signal.taskPoints)} puncte · locul{' '}
                    {signal.rank} din {signal.cohortSize}, în afara primilor{' '}
                    {signal.shareSize}
                  </span>
                </span>
                <Link
                  to={`/administrare?membru=${encodeURIComponent(signal.memberId)}`}
                  aria-label={`Editează rolul: ${shown}`}
                  className={cn(buttonVariants({ variant: 'outline' }))}
                >
                  Editează rolul
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------------ */
/* Formular de adeziune                                                      */
/* ------------------------------------------------------------------------ */

function AdherenceFormCard({
  current,
  disabled,
  onRun,
}: {
  current: string | null;
  disabled: boolean;
  onRun: Run;
}) {
  const inputId = useId();
  const hintId = useId();
  const [url, setUrl] = useState(current ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const form = useFormValidation(
    adherenceFormSchema,
    { url },
    adherenceFormFieldForReason,
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const values = form.validate();
    if (!values) return;
    try {
      await onRun({
        kind: 'orgSetting',
        key: 'adherence_form_url',
        value: values.url,
      });
      setMessage(
        values.url === null
          ? 'Adresa formularului a fost ștearsă.'
          : 'Adresa formularului a fost salvată.',
      );
    } catch (failure) {
      form.fail(failure, 'Nu am putut salva setarea. Reîncearcă.');
    }
  }

  return (
    <section aria-labelledby="period-form-title" className={card}>
      <div>
        <h2 id="period-form-title" className="text-xl font-semibold">
          Formular de adeziune
        </h2>
        <p className="text-sm text-muted-foreground">
          Linkul pe care îl primește un membru promovat Voluntar Activ.
        </p>
      </div>
      <p className="break-all">
        {current ? (
          <a
            href={current}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4"
          >
            {current}
          </a>
        ) : (
          <span className="text-muted-foreground">Niciun formular setat</span>
        )}
      </p>
      <form onSubmit={submit} noValidate className="grid max-w-xl gap-1.5">
        <label htmlFor={inputId} className="text-sm font-medium">
          Adresa formularului
        </label>
        <p id={hintId} className="text-sm text-muted-foreground">
          Începe cu http:// sau https://. Lasă gol ca să ștergi adresa.
        </p>
        <div className="flex gap-2">
          <input
            id={inputId}
            type="url"
            inputMode="url"
            className={control}
            value={url}
            disabled={disabled}
            onChange={(event) => setUrl(event.target.value)}
            {...form.field('url', hintId)}
          />
          <Button type="submit" disabled={disabled}>
            Salvează
          </Button>
        </div>
        <FieldError {...form.errorProps('url')} />
        <FieldError>{form.formError}</FieldError>
        {message && <p role="status">{message}</p>}
      </form>
    </section>
  );
}

/* ------------------------------------------------------------------------ */
/* Adunarea Generală (#512)                                                  */
/* ------------------------------------------------------------------------ */

function AdunareaGeneralaCard({
  current,
  disabled,
  onRun,
}: {
  current: string | null;
  disabled: boolean;
  onRun: Run;
}) {
  const selectId = useId();
  const groups = useAdminGroups();
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currentGroup = groups.data?.find(
    (group) => String(group.id) === current,
  );
  const choices = useMemo(
    () =>
      (groups.data ?? [])
        .filter((group) => group.status === 'active' && !group.is_private)
        .sort((a, b) => a.name.localeCompare(b.name, 'ro')),
    [groups.data],
  );
  const chosen = draft || current || '';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    try {
      await onRun({
        kind: 'orgSetting',
        key: 'adunarea_generala_group_id',
        value: chosen,
      });
      setMessage('Grupul Adunării Generale a fost salvat.');
    } catch (failure) {
      setError(
        describeFailure(failure, 'Nu am putut salva setarea. Reîncearcă.')
          .message,
      );
    }
  }

  return (
    <section aria-labelledby="period-ag-title" className={card}>
      <div>
        <h2 id="period-ag-title" className="text-xl font-semibold">
          Adunarea Generală
        </h2>
        <p className="text-sm text-muted-foreground">
          Managerii și responsabilii acestui grup văd clasamentele complete ale
          perioadelor și semnalele de retenție.
        </p>
      </div>
      <p>
        {current === null ? (
          <span className="text-muted-foreground">Niciun grup setat</span>
        ) : (
          <span className="font-semibold">
            {currentGroup?.name ?? `Grupul #${current}`}
          </span>
        )}
      </p>
      {groups.isPending ? (
        <Loading label="Se încarcă grupurile…" />
      ) : groups.isError ? (
        <p role="alert">Nu am putut încărca grupurile.</p>
      ) : (
        <form onSubmit={submit} className="grid max-w-xl gap-1.5">
          <label htmlFor={selectId} className="text-sm font-medium">
            Grupul Adunării Generale
          </label>
          <div className="flex gap-2">
            <select
              id={selectId}
              className={control}
              value={chosen}
              disabled={disabled}
              onChange={(event) => {
                setDraft(event.target.value);
                setMessage(null);
                setError(null);
              }}
            >
              {!choices.some((group) => String(group.id) === chosen) && (
                <option value={chosen}>
                  {chosen === ''
                    ? 'Alege un grup'
                    : (currentGroup?.name ?? 'Grupul actual')}
                </option>
              )}
              {choices.map((group) => (
                <option key={group.id} value={String(group.id)}>
                  {group.name}
                </option>
              ))}
            </select>
            <Button
              type="submit"
              disabled={disabled || chosen === '' || chosen === current}
            >
              Salvează
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {message && <p role="status">{message}</p>}
        </form>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------------ */
/* The panel                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * Perioade de evaluare (#702, ruling R20): where BC and the Moderator open
 * and close the Evaluation Period, seed the Promotion Threshold before the
 * first close, read the last close's Retention Signals and set the two
 * organization settings the close depends on. Mounted behind
 * `manageRoles`; every command decides again on the server.
 */
export default function PeriodsScreen() {
  const periods = useEvaluationPeriods();
  const settings = useOrgSettings();
  const command = usePeriodCommand();
  const [message, setMessage] = useState<string | null>(null);

  const run: Run = async (next) => {
    setMessage(null);
    await command.mutateAsync(next);
    if (next.kind === 'open') setMessage('Perioada a fost deschisă.');
    if (next.kind === 'close')
      setMessage(
        'Perioada a fost închisă. Pragul, promovările și semnalele au fost actualizate.',
      );
    if (next.kind === 'initialThreshold')
      setMessage('Pragul inițial a fost salvat.');
  };

  return (
    <section
      className="min-w-0 space-y-5 p-4 md:p-6"
      aria-labelledby="periods-title"
    >
      <header className="space-y-1">
        <Link
          to="/administrare"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Înapoi la Administrare
        </Link>
        <h1 id="periods-title" className="text-2xl font-bold">
          Perioade de evaluare
        </h1>
        <p className="text-muted-foreground">
          Deschiderea și închiderea perioadei, pragul de promovare și ce a
          rezultat din ultima închidere.
        </p>
      </header>

      {message && <p role="status">{message}</p>}

      {periods.isPending ? (
        <Loading label="Se încarcă perioadele…" />
      ) : periods.isError ? (
        <div role="alert" className="space-y-3">
          <p>Nu am putut încărca perioadele de evaluare.</p>
          <Button variant="outline" onClick={() => void periods.refetch()}>
            Încearcă din nou
          </Button>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <CurrentPeriodCard
            periods={periods.data}
            disabled={command.isPending}
            onRun={run}
          />
          <ThresholdCard
            periods={periods.data}
            disabled={command.isPending}
            onRun={run}
          />
          <div className="lg:col-span-2">
            <RetentionSignalsCard periods={periods.data} />
          </div>
        </div>
      )}

      {settings.isPending ? (
        <Loading label="Se încarcă setările…" />
      ) : settings.isError ? (
        <p role="alert">Nu am putut încărca setările organizației.</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <AdherenceFormCard
            current={settings.data.get('adherence_form_url') ?? null}
            disabled={command.isPending}
            onRun={run}
          />
          <AdunareaGeneralaCard
            current={settings.data.get('adunarea_generala_group_id') ?? null}
            disabled={command.isPending}
            onRun={run}
          />
        </div>
      )}
    </section>
  );
}
