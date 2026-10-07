import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { keys } from './keys';

/**
 * How long signals are collected before each affected family is invalidated
 * once. One command writes several tables in one transaction (evaluate_task:
 * tasks, task_activity, task_evaluations, points_ledger), and their signals
 * land together.
 */
const COALESCE_MS = 250;

type Prefix = readonly unknown[];

// Key prefixes that live outside `keys` (see keys.ts for the families).
const CAPABILITIES: Prefix = ['capabilities'];
const MEMBER_ROLE_GROUPS: Prefix = ['member-role-groups'];
const ANNOUNCEMENT_READERS: Prefix = ['announcements', 'readers'];

/**
 * Which query families each broadcasting table feeds (#961). A table that
 * changes what a Member may *see* — groups, group_members, profiles — also
 * feeds the families whose rows are filtered by it, because those rows emit
 * no signal of their own. Kept beside keys.ts on purpose: a new family or a
 * new table is decided here, and live_changes.test.sql fails on a table
 * nobody decided about.
 */
const FAMILIES_BY_TABLE: ReadonlyMap<string, readonly Prefix[]> = new Map<
  string,
  readonly Prefix[]
>([
  ['tasks', [keys.tasks.all, keys.leadership.all]],
  ['task_assignments', [keys.tasks.all, keys.leadership.all]],
  ['task_candidates', [keys.tasks.all]],
  ['task_evaluations', [keys.tasks.all, keys.points.all]],
  ['task_activity', [keys.tasks.all]],
  ['points_ledger', [keys.points.all, keys.members.all]],
  [
    'groups',
    [
      keys.reference.all,
      keys.groups.all,
      keys.tasks.all,
      keys.events.all,
      keys.members.all,
      keys.profile.all,
      keys.requests.all,
      keys.leadership.all,
      keys.announcements.all,
      CAPABILITIES,
    ],
  ],
  [
    'group_members',
    [
      keys.groups.all,
      keys.profile.all,
      keys.members.all,
      keys.tasks.all,
      keys.events.all,
      keys.requests.all,
      keys.points.all,
      keys.announcements.all,
      CAPABILITIES,
      MEMBER_ROLE_GROUPS,
    ],
  ],
  ['group_applications', [keys.groups.all]],
  [
    'profiles',
    [
      keys.profile.all,
      keys.members.all,
      keys.groups.all,
      keys.tasks.all,
      keys.points.all,
      CAPABILITIES,
    ],
  ],
  ['events', [keys.events.all]],
  ['event_attendance', [keys.events.all]],
  ['announcements', [keys.announcements.all]],
  // Reads are not a change to the Announcement: only its readers list. The
  // reader's own feed and badge on their other devices follow anyway: #861
  // marks their "Anunț nou" Notification read, and that UPDATE reaches them
  // on the member-filtered notifications channel, which refreshes both.
  ['announcement_reads', [ANNOUNCEMENT_READERS]],
  // R44: an Atribuție or a team place changes who may do what.
  ['bc_assignments', [keys.assignments.all, CAPABILITIES]],
  ['assignment_team', [keys.assignments.all, CAPABILITIES]],
  // deal_code_reveals broadcasts nothing (a Member's own rows, R45): the
  // revealer's cache is refreshed by the reveal itself.
  [
    'campaigns',
    [
      keys.campaigns.all,
      keys.groups.all,
      keys.leadership.all,
      keys.tasks.all,
      keys.events.all,
    ],
  ],
  ['completed_work_requests', [keys.requests.all, keys.tasks.all]],
  [
    'roles',
    [
      keys.reference.all,
      keys.groups.all,
      keys.tasks.all,
      keys.members.all,
      keys.points.all,
    ],
  ],
  ['rating_guide', [keys.reference.all]],
  ['task_difficulty_levels', [keys.reference.all]],
  [
    'org_settings',
    [
      keys.orgSettings.all,
      keys.privacy.all,
      keys.evaluation.all,
      keys.profile.all,
    ],
  ],
  ['privacy_notice_acknowledgements', [keys.privacy.all]],
  ['role_history', [keys.profile.all, keys.members.all]],
  ['role_evaluations', [keys.evaluation.all, keys.points.all]],
  ['promotion_candidates', [keys.evaluation.all, keys.points.all]],
  ['promotion_rules', [keys.evaluation.all, keys.points.all]],
  ['promotion_thresholds', [keys.evaluation.all]],
  ['promotion_threshold_changes', [keys.evaluation.all]],
]);

/**
 * Every change appears live (#961): the database broadcasts "table X
 * changed" on the private topic org:changes after every statement, and the
 * families that table feeds refetch through RLS. The payload is a table
 * name — nothing is ever rendered from it (ADR-0007, ADR-0011).
 */
export function useLiveChanges(memberId?: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!memberId) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending = new Set<string>();

    const flush = () => {
      timer = undefined;
      if (!active) return;
      const prefixes = new Set<Prefix>();
      for (const table of pending) {
        for (const prefix of FAMILIES_BY_TABLE.get(table) ?? []) {
          prefixes.add(prefix);
        }
      }
      pending.clear();
      for (const queryKey of prefixes) {
        void queryClient.invalidateQueries({ queryKey });
      }
    };

    // Lazy, like the notifications channel: the Realtime SDK path stays out
    // of the entry bundle and the PWA precache budget.
    void import('./live-changes-channel')
      .then(({ subscribe }) => {
        if (!active) return;
        unsubscribe = subscribe({
          onChange: (table) => {
            if (!active || !FAMILIES_BY_TABLE.has(table)) return;
            pending.add(table);
            timer ??= setTimeout(flush, COALESCE_MS);
          },
          onResubscribe: () => {
            if (active) void queryClient.invalidateQueries();
          },
        });
      })
      .catch(() => undefined);

    return () => {
      active = false;
      clearTimeout(timer);
      unsubscribe?.();
    };
  }, [memberId, queryClient]);
}
