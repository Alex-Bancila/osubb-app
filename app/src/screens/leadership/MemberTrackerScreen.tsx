import { useMemo, useState } from 'react';
import { useParams } from 'react-router';
import {
  BackLink,
  EmptyState,
  Page,
  PageHeader,
  Panel,
} from '../../components/layout';
import { MemberName } from '../../components/member/MemberName';
import { ErrorState, Loading } from '../../components/states';
import { WorkFilter } from '../../components/work-filter/WorkFilter';
import { formatBucharestDay } from '../../lib/calendar-time';
import { formatPoints } from '../../lib/format';
import { isUuid } from '../../lib/ids';
import { useWorkFilter } from '../../lib/use-work-filter';
import { chosenGroupId } from '../../lib/work-filter';
import {
  useLeadershipFilters,
  useLeadershipMemberTasks,
  type MemberTask,
} from '../../queries/leadership';
import { useMemberCard } from '../../queries/member-card';
import { TaskCard } from '../tracker/TaskCard';
import { LeadershipAccess } from './LeadershipAccess';
import { DifficultyStars } from '../../components/tasks/DifficultyStars';
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
                  {entry.difficulty === null ? (
                    'Dificultate: —'
                  ) : (
                    <DifficultyStars
                      value={entry.difficulty}
                      label="Dificultate:"
                    />
                  )}{' '}
                  · Nota {score(entry.rating)}
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
  if (card.isPending) return <Loading label="Se încarcă profilul…" />;
  if (card.isError || !card.data)
    return <EmptyState>Profilul nu este disponibil.</EmptyState>;
  const member = card.data;
  return (
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
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
  // A Group level can be applied only once the Group tree is known.
  const groupsReady =
    chosenGroupId(value) === undefined || options.data !== undefined;

  const count = query.data?.length
    ? rows.length === query.data.length
      ? `${rows.length} ${rows.length === 1 ? 'atribuire' : 'atribuiri'}`
      : `${rows.length} din ${query.data.length} atribuiri`
    : null;

  return (
    <Page>
      <BackToClasament />
      <PageHeader
        eyebrow="Conducere"
        title="Trackerul membrului"
        description="Toate atribuirile membrului, inclusiv cele încheiate și evaluările anulate."
      />
      <Panel aria-label="Membru">
        <MemberSummary memberId={memberId} />
      </Panel>
      <WorkFilter
        label="Filtre tracker"
        status={{
          pending: options.isPending,
          failed: options.isError,
          error: options.error,
          onRetry: () => void options.refetch(),
        }}
        groups={options.data?.groups ?? []}
        campaigns={options.data?.campaigns ?? []}
        work={options.data?.work}
        hint="Grupul include toate subgrupurile sale. Perioada citește termenul taskului, așa că un task fără termen apare doar când perioada e goală."
      />
      <Panel
        eyebrow="Taskuri"
        title="Atribuiri"
        description={count && <span className="tabular-nums">{count}</span>}
        bare
      >
        {!params ? (
          <EmptyState bare>
            Corectează perioada din filtre ca să vezi atribuirile.
          </EmptyState>
        ) : query.isPending ? (
          <Loading label="Se încarcă istoricul…" />
        ) : query.isError ? (
          <ErrorState
            error={query.error}
            text="Nu am putut încărca istoricul."
            retryLabel="Reîncarcă istoricul"
            onRetry={() => void query.refetch()}
          />
        ) : !groupsReady ? (
          options.isError ? (
            <EmptyState bare role="status">
              Filtrul de grup se aplică după ce se încarcă filtrele.
            </EmptyState>
          ) : (
            <Loading label="Se încarcă filtrele…" />
          )
        ) : !query.data.length && !ranged ? (
          <EmptyState bare>
            Nu există atribuiri disponibile pentru acest membru.
          </EmptyState>
        ) : !rows.length ? (
          <EmptyState bare>
            Nicio atribuire pentru filtrele alese. Schimbă grupul, campania sau
            perioada.
          </EmptyState>
        ) : (
          <ul className="m-0 list-none space-y-4 p-0">
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
      </Panel>
    </Page>
  );
}

/**
 * Back to the Clasament, or — when the Member Card or a Clasament row passed
 * `state.from` — to exactly where the member came from (navigation D10).
 */
function BackToClasament() {
  return <BackLink to="/clasament" label="Înapoi la clasament" />;
}

export default function MemberTrackerScreen() {
  const { id = '' } = useParams();
  return (
    <LeadershipAccess>
      {isUuid(id) ? (
        <MemberHistory memberId={id} />
      ) : (
        <Page>
          <BackToClasament />
          <PageHeader eyebrow="Conducere" title="Membru indisponibil" />
        </Page>
      )}
    </LeadershipAccess>
  );
}
