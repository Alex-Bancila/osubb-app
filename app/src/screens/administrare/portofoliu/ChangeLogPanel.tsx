import { cn } from 'cn';
import { Panel, rowListClass } from '../../../components/layout';
import { ErrorState, Loading } from '../../../components/states';
import {
  formatDayOrNull,
  formatMonthCount,
  formatPoints,
} from '../../../lib/format';
import type { RoleEvaluationKind } from '../../../lib/schemas/role-evaluation';
import {
  useThresholdChanges,
  type RoleEvaluation,
  type ThresholdChange,
} from '../../../queries/role-evaluations';
import {
  formatInstantDay,
  PERCENT_LABEL,
  runNameOf,
  THRESHOLD_LABEL,
} from './portofoliu-text';
import { Name, useChangeAuthors } from './shared';

/** The log's subject for an evaluation setting (R58), which names no kind. */
const SETTING_LABEL: Record<string, string> = {
  floor: 'Prag minim',
  cutoff: 'Data limită de intrare',
  points_start: 'Data de început a punctajului',
};

/**
 * The log's subject, by the name Setări gives it: a kind's `Prag de promovare`
 * or `Procent Voluntar Activ`, a setting by its own name or — history since
 * R58 dropped the Promotion Rules — a rule's `vechime` or `regulă pornită`.
 */
function changeSubject(change: ThresholdChange): string {
  const setting = SETTING_LABEL[change.field];
  if (setting) return setting;
  if (change.promotion_rule_id !== null) {
    return `Regulă de promovare · ${change.field === 'enabled' ? 'regulă pornită' : 'vechime'}`;
  }
  const kind = (change.kind ?? '') as RoleEvaluationKind;
  const labels = change.field === 'percent' ? PERCENT_LABEL : THRESHOLD_LABEL;
  return labels[kind] ?? kind;
}

/** The log's before → after, in each value's own unit. */
function changeValues(change: ThresholdChange): string {
  switch (change.field) {
    case 'percent':
      return `${change.from_value ?? '—'} % → ${change.to_value ?? '—'} %`;
    case 'tenure':
      return `${change.from_value === null ? '—' : formatMonthCount(change.from_value)} → ${change.to_value === null ? '—' : formatMonthCount(change.to_value)}`;
    // The two dates carry no number: the day before and the day after, and
    // `nesetat` for none, as a first Prag minim reads.
    case 'cutoff':
    case 'points_start':
      return `${formatDayOrNull(change.from_date) ?? 'nesetat'} → ${formatDayOrNull(change.to_date) ?? 'nesetat'}`;
    case 'enabled': {
      const state = (value: number | null) =>
        value === 1 ? 'pornită' : 'oprită';
      return `${state(change.from_value)} → ${state(change.to_value)}`;
    }
    default:
      return `${
        change.from_value === null ? 'nesetat' : formatPoints(change.from_value)
      } → ${change.to_value === null ? 'nesetat' : formatPoints(change.to_value)}`;
  }
}

/**
 * Every change of a threshold, a share or a setting, newest first — a record
 * of both kinds, each row naming its own field. The author is the Member who
 * made a manual change, the run for a run's write, `migrare` for a migration.
 * The page mounts it with the first change it would show (B58).
 */
export function ChangeLogPanel({
  evaluations,
}: {
  evaluations: readonly RoleEvaluation[];
}) {
  const changes = useThresholdChanges();
  const identities = useChangeAuthors(changes.data);
  return (
    <Panel title="Istoricul modificărilor">
      {changes.isPending ? (
        <Loading label="Se încarcă istoricul modificărilor…" />
      ) : changes.isError ? (
        <ErrorState
          text="Nu am putut încărca istoricul modificărilor."
          onRetry={() => void changes.refetch()}
        />
      ) : (
        <ul
          className={cn(rowListClass, 'max-h-80 overflow-y-auto text-sm')}
          aria-label="Istoricul modificărilor"
        >
          {changes.data.map((change) => (
            <li
              key={change.id}
              className="grid min-w-0 gap-0.5 py-2 first:pt-0 last:pb-0"
            >
              <span className="text-muted-foreground tabular-nums">
                {formatInstantDay(change.changed_at)} · {changeSubject(change)}
              </span>
              <span className="flex min-w-0 flex-wrap items-center gap-x-1.5">
                <span className="font-semibold tabular-nums">
                  {changeValues(change)}
                </span>
                <span aria-hidden="true" className="text-muted-foreground">
                  ·
                </span>
                {change.source === 'manual' && change.changed_by ? (
                  <Name memberId={change.changed_by} identities={identities} />
                ) : (
                  <span className="text-muted-foreground">
                    {change.source === 'migration'
                      ? 'migrare'
                      : `evaluarea „${runNameOf(evaluations, change.role_evaluation_id)}”`}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
