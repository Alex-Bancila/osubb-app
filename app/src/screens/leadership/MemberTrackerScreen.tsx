import { formatPoints } from '../../lib/format';
import { Link, useParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { formatBucharestDay } from '../../lib/calendar-time';
import type { Json } from '../../lib/database.types';
import {
  useLeadershipMemberTasks,
  useLeadershipMemberName,
} from '../../queries/leadership';
import { LeadershipAccess } from './LeadershipAccess';

const statuses: Record<string, string> = {
  todo: 'De făcut',
  in_progress: 'În lucru',
  in_review: 'În verificare',
  completed: 'Finalizat',
  unfulfilled: 'Nerealizat',
  cancelled: 'Anulat',
};
const endReasons: Record<string, string> = {
  gave_up: 'Renunțare',
  reassigned: 'Reatribuit',
  completed: 'Finalizat',
  unfulfilled: 'Nerealizat',
  cancelled: 'Anulat',
};
function objects(value: Json) {
  return Array.isArray(value)
    ? value.filter(
        (item): item is { [key: string]: Json | undefined } =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      )
    : [];
}
function text(value: Json | undefined) {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : '—';
}
function day(value: string | null | undefined) {
  return value ? formatBucharestDay(value) : '—';
}
function MemberHistory({ memberId }: { memberId: string }) {
  const query = useLeadershipMemberTasks(memberId);
  const name = useLeadershipMemberName(memberId);
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-8">
      <Link
        className="inline-flex min-h-11 items-center text-foreground underline"
        to="/clasament"
      >
        Înapoi la clasament
      </Link>
      <header>
        {name.data && (
          <p className="mb-2 font-semibold text-muted-foreground">
            {name.data}
          </p>
        )}
        <h1 className="text-3xl font-bold tracking-tight">
          Istoricul taskurilor
        </h1>
        <p className="mt-2 text-muted-foreground">
          Toate atribuirile membrului, inclusiv cele încheiate și evaluările
          anulate.
        </p>
      </header>
      {query.isPending ? (
        <p role="status">Se încarcă istoricul…</p>
      ) : query.isError ? (
        <div role="alert">
          <p>Nu am putut încărca istoricul.</p>
          <Button onClick={() => query.refetch()}>Reîncarcă istoricul</Button>
        </div>
      ) : !query.data.length ? (
        <p>Nu există atribuiri disponibile pentru acest membru.</p>
      ) : (
        <div className="space-y-4">
          {query.data.map((task) => (
            <article
              key={task.assignment_id}
              className="space-y-3 rounded-xl border border-border bg-card p-4 md:p-6"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 className="text-xl font-semibold wrap-anywhere">
                  {task.title}
                </h2>
                <span className="rounded-full bg-muted px-3 py-1 text-sm">
                  {statuses[task.status] ?? 'Stare indisponibilă'}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {task.group_name}
                {task.campaign_name && ` · ${task.campaign_name}`}
                {task.parent_task_title &&
                  ` · Subtask: ${task.parent_task_title}`}
              </p>
              {task.description && (
                <p className="whitespace-pre-wrap wrap-anywhere">
                  {task.description}
                </p>
              )}
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground">Atribuit</dt>
                  <dd>{day(task.assigned_at)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Termen</dt>
                  <dd>
                    {day(task.deadline)}
                    {task.is_overdue && ' · Întârziat'}
                    {task.completed_late && ' · Finalizat târziu'}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Atribuire</dt>
                  <dd>
                    {task.assignment_ended_at
                      ? `${endReasons[task.assignment_end_reason] ?? 'Încheiată'} · ${day(task.assignment_ended_at)}`
                      : 'Activă'}
                  </dd>
                </div>
              </dl>
              {task.assignment_end_note && (
                <p className="whitespace-pre-wrap wrap-anywhere">
                  {task.assignment_end_note}
                </p>
              )}
              {task.cancel_reason && (
                <p className="whitespace-pre-wrap wrap-anywhere">
                  Motiv anulare: {task.cancel_reason}
                </p>
              )}
              <details className="border-t border-border pt-3">
                <summary className="min-h-11 cursor-pointer font-medium">
                  Evaluări ({objects(task.evaluation_history).length})
                </summary>
                {objects(task.evaluation_history).length ? (
                  <ul className="space-y-3">
                    {objects(task.evaluation_history).map((entry, index) => (
                      <li
                        key={text(entry.id) + index}
                        className="space-y-1 rounded-lg bg-muted/50 p-3 text-sm"
                      >
                        <p className="font-semibold">
                          {entry.outcome === 'completed'
                            ? 'Finalizat'
                            : 'Nerealizat'}{' '}
                          ·{' '}
                          {typeof entry.points === 'number'
                            ? formatPoints(entry.points)
                            : '—'}{' '}
                          puncte
                          {entry.reversed_at ? ' · Evaluare anulată' : ''}
                        </p>
                        <p>
                          Dificultate: {text(entry.difficulty)} · Notă:{' '}
                          {text(entry.rating)}
                        </p>
                        <p>
                          {typeof entry.evaluated_at === 'string'
                            ? day(entry.evaluated_at)
                            : '—'}
                        </p>
                        {entry.note && (
                          <p className="whitespace-pre-wrap wrap-anywhere">
                            {text(entry.note)}
                          </p>
                        )}
                        {entry.reversed_at && (
                          <p className="whitespace-pre-wrap wrap-anywhere">
                            Anulată la{' '}
                            {typeof entry.reversed_at === 'string'
                              ? day(entry.reversed_at)
                              : '—'}{' '}
                            · {text(entry.reversal_reason)}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Nicio evaluare pentru această atribuire.
                  </p>
                )}
              </details>
              {objects(task.subtasks).length > 0 && (
                <details className="border-t border-border pt-3">
                  <summary className="min-h-11 cursor-pointer font-medium">
                    Subtaskuri ({objects(task.subtasks).length})
                  </summary>
                  <ul className="space-y-2">
                    {objects(task.subtasks).map((child, index) => (
                      <li key={text(child.id) + index}>
                        {text(child.title)} ·{' '}
                        {statuses[text(child.status)] ?? 'Stare indisponibilă'}
                        {child.completed_late && ' · Finalizat târziu'}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
export default function MemberTrackerScreen() {
  const { id = '' } = useParams();
  const valid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  return (
    <LeadershipAccess>
      {valid ? (
        <MemberHistory memberId={id} />
      ) : (
        <div className="p-6">
          <h1>Membru indisponibil</h1>
          <Link to="/clasament">Înapoi la clasament</Link>
        </div>
      )}
    </LeadershipAccess>
  );
}
