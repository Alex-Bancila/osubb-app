import { Button } from '../../components/ui/button';
import { formatDayMonthYear, formatPoints } from '../../lib/format';
import { useRoleEvaluations } from '../../queries/evaluation-periods';

const card = 'space-y-3 rounded-xl border bg-card p-4 md:p-5';

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

/**
 * The Administrare tab **Evaluări de rol** (#825; ruling R28): until #827
 * rebuilds it, it lists the Role Evaluations run so far (#826). The two
 * organization settings it used to hold live in the Setări tab. Mounted
 * behind `manageRoles`; the server decides every read again.
 */
export default function PeriodsScreen() {
  return <RoleEvaluationsCard />;
}
