import { Button } from '../../components/ui/button';
import {
  formatBucharestDay,
  formatBucharestTime,
} from '../../lib/calendar-time';
import type { Database, Json } from '../../lib/database.types';
import { useTaskHistory, type TaskActivity } from '../../queries/task-history';

const kinds: Record<string, string> = {
  created: 'Task creat',
  assigned: 'Executor atribuit',
  executor_assigned: 'Executor atribuit',
  started: 'Lucru început',
  submitted: 'Trimis la verificare',
  submitted_for_review: 'Trimis la verificare',
  returned_to_progress: 'Returnat pentru modificări',
  evaluated: 'Task evaluat',
  completed: 'Task finalizat',
  unfulfilled: 'Task nerealizat',
  cancelled: 'Task anulat',
  reopened: 'Task redeschis',
  content_updated: 'Conținut actualizat',
  interest_expressed: 'Înscriere în lista de așteptare',
  interest_withdrawn: 'Înscriere retrasă',
  candidate_selected: 'Candidat selectat',
  queue_opened: 'Listă de așteptare deschisă',
  queue_closed: 'Listă de așteptare închisă',
  gave_up: 'Renunțare la task',
  executor_gave_up: 'Renunțare la task',
  umbrella_completed: 'Task-umbrelă finalizat',
  duplicated: 'Task duplicat',
  mode_converted: 'Mod de atribuire schimbat',
};
const statuses: Record<Database['public']['Enums']['task_status'], string> = {
  todo: 'De făcut',
  in_progress: 'În lucru',
  in_review: 'În verificare',
  completed: 'Finalizat',
  unfulfilled: 'Nerealizat',
  cancelled: 'Anulat',
};
const fields: Record<string, string> = {
  title: 'Titlu',
  description: 'Descriere',
  deadline: 'Termen',
  difficulty: 'Dificultate',
  rating: 'Notă',
  audience: 'Audiență',
  assignment_mode: 'Atribuire',
  campaign_id: 'Campanie',
};
// #626's task_updated activity carries `details.changed`: the raw field
// names an edit touched, in server order. Reused as the sentence's field
// list (lower-cased, `fields`' own labels are capitalized headers for the
// before/after blocks below) and, defensively, if `changed` is missing or
// unreadable the label just falls back to the bare kind name.
function taskUpdatedFieldNames(details: Json): string[] {
  if (!details || typeof details !== 'object' || Array.isArray(details))
    return [];
  const changed = details.changed;
  if (!Array.isArray(changed)) return [];
  return changed.flatMap((field) =>
    typeof field === 'string' && fields[field]
      ? [fields[field].toLowerCase()]
      : [],
  );
}
function taskUpdatedLabel(details: Json): string {
  const names = taskUpdatedFieldNames(details);
  return names.length
    ? `Task actualizat: ${names.join(', ')}`
    : 'Task actualizat';
}
const consequenceLabels: Record<string, string> = {
  executor_removed: 'executorul a fost eliminat',
  candidate_removed: 'o candidatură a fost închisă',
};
// details.consequences (private.task_update_consequences, #626/#627) is one
// row per Candidate closed or per Executor removed -- named here by
// kind and count, never by member id, since the history feed does not
// resolve those ids to names (only actor_id is joined against the
// directory).
function taskUpdatedConsequences(details: Json): string[] {
  if (!details || typeof details !== 'object' || Array.isArray(details))
    return [];
  const consequences = details.consequences;
  if (!Array.isArray(consequences)) return [];
  const counts = new Map<string, number>();
  for (const entry of consequences) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const kind = entry.consequence;
    if (typeof kind !== 'string' || !consequenceLabels[kind]) continue;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return [...counts.entries()].map(([kind, count]) =>
    kind === 'candidate_removed' && count > 1
      ? `${count} candidaturi au fost închise`
      : (consequenceLabels[kind] ?? kind),
  );
}
function changes(details: Json, side: 'before' | 'after') {
  if (!details || typeof details !== 'object' || Array.isArray(details))
    return [];
  const values = details[side] ?? details[side === 'before' ? 'from' : 'to'];
  if (!values || typeof values !== 'object' || Array.isArray(values)) return [];
  return Object.entries(values).flatMap(([field, value]) => {
    if (
      !fields[field] ||
      (value !== null && typeof value !== 'string' && typeof value !== 'number')
    )
      return [];
    const text =
      field === 'deadline' && typeof value === 'string'
        ? `${formatBucharestDay(value)}, ${formatBucharestTime(value)}`
        : field === 'audience'
          ? value === 'org'
            ? 'OSUBB'
            : value === 'local'
              ? 'Locală'
              : '—'
          : field === 'assignment_mode'
            ? value === 'public'
              ? 'Publică'
              : value === 'direct'
                ? 'Directă'
                : '—'
            : field === 'campaign_id' && value !== null
              ? `#${value}`
              : String(value ?? '—');
    return [`${fields[field]}: ${text}`];
  });
}
export function TaskTimeline({ activity }: { activity: TaskActivity[] }) {
  if (!activity.length)
    return (
      <p>Nu există activitate vizibilă. Istoricul vechi poate fi incomplet.</p>
    );
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Sunt afișate doar înregistrările pe care le poți consulta.
      </p>
      <ol
        className="space-y-5 border-l border-border pl-4"
        aria-label="Activitatea taskului"
      >
        {[...activity]
          .sort(
            (a, b) =>
              Date.parse(a.occurred_at) - Date.parse(b.occurred_at) ||
              a.id - b.id,
          )
          .map((entry) => (
            <li key={entry.id} className="space-y-1 text-sm wrap-anywhere">
              <p className="font-semibold">
                {entry.kind === 'task_updated'
                  ? taskUpdatedLabel(entry.details)
                  : (kinds[entry.kind] ?? 'Activitate înregistrată')}
              </p>
              <p>
                {entry.actor_id
                  ? (entry.actorName ?? 'Membru indisponibil')
                  : 'Sistem'}{' '}
                ·{' '}
                <time dateTime={entry.occurred_at}>
                  {formatBucharestDay(entry.occurred_at)},{' '}
                  {formatBucharestTime(entry.occurred_at)}
                </time>
              </p>
              {(entry.from_status || entry.to_status) && (
                <p>
                  {entry.from_status ? statuses[entry.from_status] : '—'} →{' '}
                  {entry.to_status ? statuses[entry.to_status] : '—'}
                </p>
              )}
              {entry.note && (
                <p className="whitespace-pre-wrap">{entry.note}</p>
              )}
              {entry.kind === 'task_updated' &&
                taskUpdatedConsequences(entry.details).map((line) => (
                  <p key={line} className="text-muted-foreground">
                    {line}
                  </p>
                ))}
              {(['before', 'after'] as const).map((side) => {
                const lines = changes(entry.details, side);
                return lines.length ? (
                  <div key={side}>
                    <p className="font-medium">
                      {side === 'before' ? 'Înainte' : 'După'}
                    </p>
                    {lines.map((line) => (
                      <p key={line} className="whitespace-pre-wrap">
                        {line}
                      </p>
                    ))}
                  </div>
                ) : null;
              })}
            </li>
          ))}
      </ol>
    </div>
  );
}
export function TaskHistory({ taskId }: { taskId: number }) {
  const query = useTaskHistory(taskId);
  if (query.isPending) return <p role="status">Se încarcă istoricul…</p>;
  if (query.isError)
    return (
      <div role="alert">
        <p>Nu am putut încărca istoricul.</p>
        <Button
          className="min-h-11 min-w-11"
          variant="outline"
          onClick={() => query.refetch()}
        >
          Reîncarcă istoricul
        </Button>
      </div>
    );
  return <TaskTimeline activity={query.data} />;
}
