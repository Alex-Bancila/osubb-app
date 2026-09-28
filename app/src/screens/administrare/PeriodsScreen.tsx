import { useId, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Button } from '../../components/ui/button';
import { FieldError } from '../../components/ui/field';
import { describeFailure } from '../../lib/command-reasons';
import { formatDayMonthYear, formatPoints } from '../../lib/format';
import {
  adherenceFormFieldForReason,
  adherenceFormSchema,
} from '../../lib/schemas/evaluation-period';
import { safeHttpUrl } from '../../lib/links';
import { useFormValidation } from '../../lib/use-form-validation';
import {
  useOrgSettings,
  usePeriodCommand,
  useRoleEvaluations,
  type PeriodCommand,
} from '../../queries/evaluation-periods';
import { useAdminGroups } from '../../queries/groups-admin';

const control =
  'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';
const card = 'space-y-3 rounded-xl border bg-card p-4 md:p-5';

type Run = (command: PeriodCommand) => Promise<void>;

/** The panel's cards all wait on the same read state before they show. */
function Loading({ label }: { label: string }) {
  return <p role="status">{label}</p>;
}

/* ------------------------------------------------------------------------ */
/* Evaluări de rol (read-only until #827)                                    */
/* ------------------------------------------------------------------------ */

const KIND_LABEL: Record<string, string> = {
  voluntar_activ: 'Voluntar Activ',
  adunarea_generala: 'Adunarea Generală',
};

/** `2026-09-25` as `25 septembrie 2026`, a calendar day with no zone shift. */
function formatDate(iso: string) {
  return formatDayMonthYear(iso) ?? iso;
}

/**
 * The Role Evaluations run so far (#826, ruling R28), newest first. Nothing
 * is opened or closed any more; running an evaluation, the two thresholds and
 * the Promotion Candidates arrive with #827.
 */
function RoleEvaluationsCard() {
  const evaluations = useRoleEvaluations();
  return (
    <section aria-labelledby="role-evaluations-title" className={card}>
      <div>
        <h2 id="role-evaluations-title" className="text-xl font-semibold">
          Istoricul evaluărilor de rol
        </h2>
        <p className="text-sm text-muted-foreground">
          Rularea evaluărilor de rol vine cu #827.
        </p>
      </div>
      {evaluations.isPending ? (
        <Loading label="Se încarcă evaluările…" />
      ) : evaluations.isError ? (
        <div role="alert" className="space-y-3">
          <p>Nu am putut încărca evaluările de rol.</p>
          <Button variant="outline" onClick={() => void evaluations.refetch()}>
            Încearcă din nou
          </Button>
        </div>
      ) : evaluations.data.length === 0 ? (
        <p className="text-muted-foreground">Nicio evaluare de rol încă.</p>
      ) : (
        <ul className="divide-y" aria-label="Evaluări de rol">
          {evaluations.data.map((evaluation) => (
            <li key={evaluation.id} className="grid gap-0.5 py-3">
              <span className="font-medium">{evaluation.name}</span>
              <span className="text-sm text-muted-foreground">
                {KIND_LABEL[evaluation.kind] ?? evaluation.kind} ·{' '}
                {formatDate(evaluation.period_from)} –{' '}
                {formatDate(evaluation.period_to)} · prag folosit{' '}
                {formatPoints(evaluation.threshold_used)} · prag calculat{' '}
                {evaluation.threshold_computed === null
                  ? '—'
                  : formatPoints(evaluation.threshold_computed)}
              </span>
            </li>
          ))}
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
  const currentUrl = safeHttpUrl(current);
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
        {currentUrl ? (
          <a
            href={currentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4"
          >
            {current}
          </a>
        ) : current ? (
          // Not http(s): shown as text so BC can see and replace it, never as a link.
          <span>{current}</span>
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
 * Perioade de evaluare (#702, ruling R20; reduced by #826, ruling R28): no
 * Evaluation Period is opened or closed any more. Until #827 rebuilds this
 * tab as Evaluări de rol, it lists the Role Evaluations run so far and keeps
 * the two organization settings a Role Evaluation depends on. Mounted behind
 * `manageRoles`; every command decides again on the server.
 */
export default function PeriodsScreen() {
  const settings = useOrgSettings();
  const command = usePeriodCommand();

  const run: Run = async (next) => {
    await command.mutateAsync(next);
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
          Evaluările de rol rulate până acum și setările de care depind.
        </p>
      </header>

      <RoleEvaluationsCard />

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
