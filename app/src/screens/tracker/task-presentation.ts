import type { Database } from '../../lib/database.types';
import {
  formatBucharestDay,
  formatBucharestTime,
} from '../../lib/calendar-time';

type Tables = Database['public']['Tables'];
type Task = Tables['tasks']['Row'];
export type TaskStatus = Task['status'];

/** Only authorized relations belong here. Missing embeds can mean RLS hid them. */
export type TaskPresentationRow = Pick<
  Task,
  | 'id'
  | 'title'
  | 'description'
  | 'status'
  | 'deadline'
  | 'completed_at'
  | 'review_round'
  | 'group_id'
  | 'assignment_mode'
  | 'audience'
  | 'kind'
  | 'parent_task_id'
  | 'campaign_id'
  | 'duplicated_from_task_id'
  | 'queue_closed_at'
  | 'link_label'
  | 'link_url'
> & {
  /** The Task's Origin Group; null when RLS withholds it. */
  group?: Pick<
    Tables['groups']['Row'],
    'name' | 'short' | 'color' | 'category' | 'path' | 'is_organization'
  > | null;
  /**
   * The latest `submitted` history row (#685), embedded through
   * `task_activity`'s own RLS: at most one row, empty when the Task was never
   * submitted or the reader may not see its history.
   */
  submission?: Pick<
    Tables['task_activity']['Row'],
    'id' | 'kind' | 'note' | 'details' | 'occurred_at'
  >[];
  campaign?: Pick<Tables['campaigns']['Row'], 'name'> | null;
  parent?: Pick<Task, 'title'> | null;
  assignments?: Pick<
    Tables['task_assignments']['Row'],
    'id' | 'member_id' | 'ended_at'
  >[];
  /** Explicitly null means #499's safe Executor lookup found no active row. */
  visibleExecutor?: {
    memberId: string;
    fullName: string | null;
    nickname?: string | null;
  } | null;
  evaluations?: Pick<
    Tables['task_evaluations']['Row'],
    'id' | 'difficulty' | 'rating' | 'points' | 'reversed_at'
  >[];
  subtasks?: Pick<Task, 'id' | 'status'>[];
};

export type TaskPresentation = {
  id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  statusLabel: string;
  origin: {
    /** The Origin Group's id. */
    id: number;
    label: string;
    color: string | null;
  };
  audience: 'local' | 'org' | null;
  audienceLabel: string;
  assignmentMode: 'direct' | 'public' | null;
  executor: {
    memberId: string;
    assignmentId: number | null;
    name: string | null;
    nickname: string | null;
  } | null;
  candidature: {
    status: 'pending' | 'selected' | 'withdrawn' | 'closed';
    position: number | null;
  } | null;
  deadline: string | null;
  deadlineLabel: string;
  overdue: boolean;
  feedbackPending: boolean;
  completedLate: boolean;
  queueClosed: boolean;
  reviewRound: number;
  difficulty: number | null;
  rating: number | null;
  points: number | null;
  kind: 'task' | 'umbrella';
  /** Counts only the supplied, authorized Subtasks; null means not loaded. */
  subtaskProgress: { terminal: number; total: number } | null;
  parent: { id: number; title: string } | null;
  campaign: { id: number; name: string } | null;
  duplicatedFromTaskId: number | null;
  /** The Task's one Attached Link (#684), or null. */
  link: { label: string; url: string } | null;
  /**
   * The latest Submission Note (CONTEXT.md, ruling R7): what the Executor
   * wrote and linked when they last submitted. Null when there is none, or
   * the last submission carried neither a note nor a link.
   */
  submission: {
    note: string | null;
    link: { label: string; url: string } | null;
    submittedAt: string;
  } | null;
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'De făcut',
  in_progress: 'În lucru',
  in_review: 'În verificare',
  completed: 'Finalizat',
  unfulfilled: 'Nerealizat',
  cancelled: 'Anulat',
};

export function isTerminalTask(status: TaskStatus): boolean {
  return ['completed', 'unfulfilled', 'cancelled'].includes(status);
}

function validInstant(value: string | null): string | null {
  return value && Number.isFinite(Date.parse(value)) ? value : null;
}

/**
 * `groups.category` is a presentation label (ADR-0009): it picks the noun in
 * front of the Group's name and decides nothing else.
 */
const GROUP_CATEGORY_NOUNS: Record<string, string> = {
  department: 'Departament',
  team: 'Echipă',
  project: 'Proiect',
};

/** The Task's Origin, labelled from its Group. */
export function taskOrigin(
  row: Pick<TaskPresentationRow, 'group_id' | 'group'>,
): TaskPresentation['origin'] {
  const group = row.group;
  const name = group?.name?.trim();
  // No embed means RLS withheld the Group; never show an id in its place.
  if (!group || !name)
    return { id: row.group_id, label: 'Origine indisponibilă', color: null };
  const noun = GROUP_CATEGORY_NOUNS[group.category];
  return {
    id: row.group_id,
    label: noun ? `${noun} · ${name}` : name,
    // The Organization Group is always OSUBB red (ruling R10), whatever its
    // row stores; `is_organization` says which Group that is.
    color: group.is_organization ? 'var(--scope-org)' : (group.color ?? null),
  };
}

function linkPair(label: unknown, url: unknown) {
  const text = typeof label === 'string' ? label.trim() : '';
  const address = typeof url === 'string' ? url.trim() : '';
  return text && address ? { label: text, url: address } : null;
}

/** The newest `submitted` row, as the Submission Note it carries. */
function latestSubmission(
  rows: TaskPresentationRow['submission'],
): TaskPresentation['submission'] {
  const latest = rows
    ?.filter((row) => row.kind === 'submitted')
    .reduce<NonNullable<typeof rows>[number] | null>(
      (newest, row) => (!newest || row.id > newest.id ? row : newest),
      null,
    );
  if (!latest) return null;
  const details =
    latest.details &&
    typeof latest.details === 'object' &&
    !Array.isArray(latest.details)
      ? latest.details
      : {};
  const note = latest.note?.trim() || null;
  const link = linkPair(details.link_label, details.link_url);
  return note || link ? { note, link, submittedAt: latest.occurred_at } : null;
}

/** Pure mapping: the caller supplies the clock and their own queue state. */
export function toTaskPresentation(
  row: TaskPresentationRow,
  now: Date,
  candidature: TaskPresentation['candidature'] = null,
): TaskPresentation {
  const deadline = validInstant(row.deadline);
  const completedAt = validInstant(row.completed_at);
  const kind = row.kind === 'umbrella' ? 'umbrella' : 'task';
  const activeAssignment = row.assignments?.find(
    (item) => item.ended_at === null,
  );
  const visibleExecutor =
    row.visibleExecutor === undefined
      ? activeAssignment
        ? { memberId: activeAssignment.member_id, fullName: null }
        : null
      : row.visibleExecutor;
  // RLS may withhold Evaluations. Absence is unknown, never zero points.
  const evaluation =
    kind === 'task' && ['completed', 'unfulfilled'].includes(row.status)
      ? row.evaluations
          ?.filter((item) => item.reversed_at === null)
          .reduce<
            NonNullable<TaskPresentationRow['evaluations']>[number] | null
          >(
            (latest, item) => (!latest || item.id > latest.id ? item : latest),
            null,
          )
      : null;

  return {
    id: row.id,
    title: row.title.trim() || 'Task fără titlu',
    description: row.description?.trim() || null,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status],
    origin: taskOrigin(row),
    audience:
      row.audience === 'local' || row.audience === 'org' ? row.audience : null,
    audienceLabel:
      row.audience === 'local'
        ? 'În cadrul originii'
        : row.audience === 'org'
          ? 'În tot OSUBB'
          : 'Audiență indisponibilă',
    assignmentMode:
      row.assignment_mode === 'direct' || row.assignment_mode === 'public'
        ? row.assignment_mode
        : null,
    executor:
      kind === 'task' && visibleExecutor
        ? {
            memberId: visibleExecutor.memberId,
            assignmentId:
              activeAssignment?.member_id === visibleExecutor.memberId
                ? activeAssignment.id
                : null,
            name: visibleExecutor.fullName?.trim() || null,
            nickname: visibleExecutor.nickname?.trim() || null,
          }
        : null,
    candidature: kind === 'task' ? candidature : null,
    deadline,
    deadlineLabel: deadline
      ? `${formatBucharestDay(deadline)}, ${formatBucharestTime(deadline)}`
      : 'Fără termen',
    overdue:
      !isTerminalTask(row.status) &&
      deadline !== null &&
      Date.parse(deadline) < now.getTime(),
    feedbackPending: row.status === 'in_progress' && row.review_round > 0,
    completedLate:
      row.status === 'completed' &&
      deadline !== null &&
      completedAt !== null &&
      Date.parse(completedAt) > Date.parse(deadline),
    queueClosed: validInstant(row.queue_closed_at) !== null,
    reviewRound: row.review_round,
    difficulty: evaluation?.difficulty ?? null,
    rating: evaluation?.rating ?? null,
    points: evaluation?.points ?? null,
    kind,
    subtaskProgress:
      kind === 'umbrella' && row.subtasks
        ? {
            total: row.subtasks.length,
            terminal: row.subtasks.filter((task) => isTerminalTask(task.status))
              .length,
          }
        : null,
    parent:
      row.parent_task_id === null
        ? null
        : {
            id: row.parent_task_id,
            title: row.parent?.title?.trim() || 'Task-umbrelă',
          },
    campaign:
      row.campaign_id === null
        ? null
        : {
            id: row.campaign_id,
            name: row.campaign?.name?.trim() || 'Campanie',
          },
    duplicatedFromTaskId: row.duplicated_from_task_id,
    link: linkPair(row.link_label, row.link_url),
    submission: kind === 'task' ? latestSubmission(row.submission) : null,
  };
}
