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
};
function changes(details: Json, side: 'before' | 'after') {
  if (!details || typeof details !== 'object' || Array.isArray(details))
    return [];
  const values = details[side];
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
                {kinds[entry.kind] ?? 'Activitate înregistrată'}
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
