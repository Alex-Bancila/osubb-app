import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { MemberName } from '../../components/member/MemberName';
import { Button } from '../../components/ui/button';
import { WorkFilter } from '../../components/work-filter/WorkFilter';
import { formatBucharestDay } from '../../lib/calendar-time';
import { formatPoints } from '../../lib/format';
import { useWorkFilter } from '../../lib/use-work-filter';
import {
  useLeadershipFilters,
  useLeadershipMemberTasks,
  type MemberTask,
} from '../../queries/leadership';
import { useMemberCard } from '../../queries/member-card';
import { TaskCard } from '../tracker/TaskCard';
import { LeadershipAccess } from './LeadershipAccess';
import {
  filterMemberTasks,
  historyEvaluations,
  historySubtasks,
  memberTaskPresentation,
  type HistoryGroup,
} from './member-history';

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
function day(value: string | null | undefined) {
  return value ? formatBucharestDay(value) : '—';
}
const score = (value: number | null) => (value === null ? '—' : String(value));

/** The Assignment's own record, under the card's Task summary. */
function AssignmentRecord({ task }: { task: MemberTask }) {
  const evaluations = historyEvaluations(task.evaluation_history);
  const subtasks = historySubtasks(task.subtasks);
  return (
    <div className="space-y-3 border-t border-border pt-3 text-sm">
      <dl className="grid grid-cols-2 gap-3">
        <div>
          <dt className="text-muted-foreground">Atribuit</dt>
          <dd>{day(task.assigned_at)}</dd>
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
      <details className="border-t border-border pt-2">
        <summary className="flex min-h-11 cursor-pointer items-center font-medium">
          Evaluări ({evaluations.length})
        </summary>
        {evaluations.length ? (
          <ul className="space-y-2">
            {evaluations.map((entry) => (
              <li
                key={entry.id}
                className="space-y-1 rounded-lg bg-muted/50 p-3"
              >
                <p className="font-semibold tabular-nums">
                  {entry.outcome === 'completed' ? 'Finalizat' : 'Nerealizat'} ·{' '}
                  {entry.points === null ? '—' : formatPoints(entry.points)}{' '}
                  puncte
                  {entry.reversedAt ? ' · Evaluare anulată' : ''}
                </p>
                <p>
                  Dificultate: {score(entry.difficulty)} · Notă:{' '}
                  {score(entry.rating)}
                </p>
                <p className="text-muted-foreground">
                  {day(entry.evaluatedAt)}
                </p>
                {entry.note && (
                  <p className="whitespace-pre-wrap wrap-anywhere">
                    {entry.note}
                  </p>
                )}
                {entry.reversedAt && (
                  <p className="whitespace-pre-wrap wrap-anywhere">
                    Anulată la {day(entry.reversedAt)} ·{' '}
                    {entry.reversalReason ?? '—'}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">
            Nicio evaluare pentru această atribuire.
          </p>
        )}
      </details>
      {subtasks.length > 0 && (
        <details className="border-t border-border pt-2">
          <summary className="flex min-h-11 cursor-pointer items-center font-medium">
            Subtaskuri ({subtasks.length})
          </summary>
          <ul className="space-y-1">
            {subtasks.map((child) => (
              <li key={child.id}>
                {child.title} ·{' '}
                {statuses[child.status] ?? 'Stare indisponibilă'}
                {child.completedLate && ' · Finalizat târziu'}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** The Member Card's summary (#676): Nickname, full name, Role and Groups. */
function MemberSummary({ memberId }: { memberId: string }) {
  const card = useMemberCard(memberId);
  if (card.isPending)
    return (
      <p role="status" className="text-muted-foreground">
        Se încarcă profilul…
      </p>
    );
  if (card.isError || !card.data)
    return (
      <p className="text-muted-foreground">Profilul nu este disponibil.</p>
    );
  const member = card.data;
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <MemberName
          memberId={member.memberId}
          nickname={member.nickname}
          fullName={member.fullName}
          avatarColor={member.avatarColor}
          showFullName
        />
        {member.roleLabel && (
          <p className="text-sm text-muted-foreground">{member.roleLabel}</p>
        )}
      </div>
      {member.groups.length > 0 && (
        <ul
          aria-label="Grupuri"
          className="flex min-w-0 flex-wrap gap-1.5 sm:justify-end"
        >
          {member.groups.map((group) => (
            <li
              key={group.id}
              className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-xs font-medium"
            >
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: group.color ?? 'var(--brand-red)' }}
              />
              <span className="truncate">{group.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MemberHistory({ memberId }: { memberId: string }) {
  const { value, params } = useWorkFilter();
  // The server narrows by deadline (#677); Group and Campaign narrow here.
  const range = params && {
    ...(params.p_from !== undefined && { p_from: params.p_from }),
    ...(params.p_to !== undefined && { p_to: params.p_to }),
  };
  const query = useLeadershipMemberTasks(memberId, range);
  const options = useLeadershipFilters();
  const [now] = useState(() => new Date());
  const groupsById = useMemo(
    () =>
      new Map<number, HistoryGroup>(
        (options.data?.groups ?? []).map((group) => [group.id, group]),
      ),
    [options.data],
  );
  const rows = useMemo(
    () => (query.data ? filterMemberTasks(query.data, value, groupsById) : []),
    [query.data, value, groupsById],
  );
  const ranged = Boolean(range?.p_from || range?.p_to);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-8">
      <Link
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline"
        to="/clasament"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Înapoi la clasament
      </Link>
      <header className="space-y-4">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-muted-foreground">
            OSUBB · Conducere
          </p>
          <h1 className="text-3xl font-bold tracking-tight">
            Trackerul membrului
          </h1>
          <p className="text-muted-foreground">
            Toate atribuirile membrului, inclusiv cele încheiate și evaluările
            anulate.
          </p>
        </div>
        <MemberSummary memberId={memberId} />
      </header>
      <section
        aria-label="Filtre tracker"
        className="rounded-xl border border-border bg-card p-4"
      >
        {options.isPending ? (
          <p role="status">Se încarcă filtrele…</p>
        ) : options.isError ? (
          <div role="alert">
            <p>Nu am putut încărca filtrele.</p>
            <Button variant="outline" onClick={() => options.refetch()}>
              Reîncarcă filtrele
            </Button>
          </div>
        ) : (
          <WorkFilter
            groups={options.data.groups}
            campaigns={options.data.campaigns}
            hint="Grupul include toate subgrupurile sale. Perioada citește termenul taskului, așa că un task fără termen apare doar când perioada e goală."
          />
        )}
      </section>
      <section aria-labelledby="assignments-title" className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="assignments-title" className="text-xl font-semibold">
            Atribuiri
          </h2>
          {query.data && query.data.length > 0 && (
            <p className="text-sm text-muted-foreground tabular-nums">
              {rows.length === query.data.length
                ? `${rows.length} ${rows.length === 1 ? 'atribuire' : 'atribuiri'}`
                : `${rows.length} din ${query.data.length} atribuiri`}
            </p>
          )}
        </div>
        {!params ? (
          <p>Corectează perioada din filtre ca să vezi atribuirile.</p>
        ) : query.isPending ? (
          <p role="status">Se încarcă istoricul…</p>
        ) : query.isError ? (
          <div role="alert">
            <p>Nu am putut încărca istoricul.</p>
            <Button onClick={() => query.refetch()}>Reîncarcă istoricul</Button>
          </div>
        ) : !query.data.length && !ranged ? (
          <p>Nu există atribuiri disponibile pentru acest membru.</p>
        ) : !rows.length ? (
          <p>
            Nicio atribuire pentru filtrele alese. Schimbă grupul, campania sau
            perioada.
          </p>
        ) : (
          <ul className="space-y-4">
            {rows.map((task) => (
              <li key={task.assignment_id}>
                <TaskCard
                  task={memberTaskPresentation(task, groupsById, now)}
                  anchor={false}
                  history={<AssignmentRecord task={task} />}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
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
