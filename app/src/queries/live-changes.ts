import { useEffect } from 'react';
import {
  focusManager,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { keys } from './keys';

/**
 * How long signals are collected before each affected family is invalidated
 * once. One command writes several tables in one transaction (evaluate_task:
 * tasks, task_activity, task_evaluations, points_ledger), and their signals
 * land together.
 */
const COALESCE_MS = 250;

/**
 * How long a family rests after it is invalidated (#1148). A signal for it
 * meanwhile is kept, and the family is invalidated once more as the window
 * closes, which opens the next one: leading and trailing. A burst — an
 * import stamping one profile per row — so costs each family at most one
 * refetch a window, and a change still shows within it. An invalidation
 * never restarts a read already on its way (`cancelRefetch: false`); such a
 * read may have begun before the change, so the window's end reads the
 * family again. A read still on its way when that window closes is left
 * alone too, and asks for no further window: whatever it missed shows at
 * the next signal or focus, rather than every idle query of the family
 * being read every two seconds behind one slow read.
 */
const THROTTLE_MS = 2_000;

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
  ['events', [keys.events.all, keys.approvals.all]],
  ['event_attendance', [keys.events.all]],
  ['announcements', [keys.announcements.all, keys.approvals.all]],
  // Reads are not a change to the Announcement: only its readers list. On
  // the reader's other devices the counts follow at once: #861 marks their
  // "Anunț nou" Notification read, and that UPDATE reaches them on the
  // member-filtered notifications channel, which refreshes the badge and the
  // feed's summary. The card itself shows the read at the feed's next read
  // — a window focus once it is stale, or any change that reads it again —
  // because an UPDATE never re-reads the pages the Member is reading (R56).
  ['announcement_reads', [ANNOUNCEMENT_READERS]],
  // R47: a team place changes who may do what.
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
  /* #1146: the population a finished run kept; its sheet reads the run. */
  ['role_evaluation_members', [keys.evaluation.all]],
  ['promotion_candidates', [keys.evaluation.all, keys.points.all]],
  /* R58: the stored Retention Signals the page reads. */
  ['retention_signals', [keys.evaluation.all]],
  ['promotion_thresholds', [keys.evaluation.all]],
  ['promotion_threshold_changes', [keys.evaluation.all]],
  /* R58: the Points Start Date moves every total on the page. */
  [
    'evaluation_settings',
    [keys.evaluation.all, keys.points.all, keys.campaigns.all],
  ],
]);

/**
 * How many loaded pages a list read by the page keeps over a change while
 * someone is looking at it, to be read again in place: three pages of 50
 * Tasks keep a Member's place in Taskuri încheiate at a cost of at most
 * three requests per change (#1135).
 */
const KEPT_PAGES = 3;

/**
 * A list read by the page — the finished part of a Task list, 50 at a time
 * (#1053) — is an infinite query, and a refetch of one reads again every
 * page it has loaded. Before its family is invalidated, each such list under
 * `queryKey` is cut to the pages it keeps, which the invalidation then reads
 * again in place: up to `KEPT_PAGES` while the list is on screen, so a
 * Member scrolled into Taskuri încheiate keeps their place over a Task
 * changed anywhere (#1135); its first page alone when nobody is looking —
 * no observer (a tab the Member left) or a hidden document
 * (`focusManager`) — so a change costs it at most one request. The pages
 * dropped are read again as the Member scrolls to them.
 *
 * The Anunțuri feed (R56) is not cut at all: a Member reading its fifth
 * page would lose their place over any Announcement, Group or roster
 * changed anywhere. A change reads every page it has loaded again instead.
 */
function keepPages(queryClient: QueryClient, queryKey: QueryKey) {
  const looking = focusManager.isFocused();
  for (const query of queryClient.getQueryCache().findAll({ queryKey })) {
    const data = query.state.data as InfiniteData<unknown, unknown> | undefined;
    const kept = looking && query.isActive() ? KEPT_PAGES : 1;
    if (!data || data.pages.length <= kept) continue;
    queryClient.setQueryData<InfiniteData<unknown, unknown>>(query.queryKey, {
      pages: data.pages.slice(0, kept),
      pageParams: data.pageParams.slice(0, kept),
    });
  }
}

/** Each list read by the page, beside the family whose change re-reads it. */
const PAGED_LISTS: readonly (readonly [family: Prefix, pages: Prefix])[] = [
  [keys.tasks.all, keys.tasks.finishedAll],
];

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
    // Each resting family's window, and whether it closes with a re-read.
    const windows = new Map<
      Prefix,
      { timer: ReturnType<typeof setTimeout>; again: boolean }
    >();

    const invalidate = (queryKey: Prefix) => {
      for (const [family, pages] of PAGED_LISTS)
        if (family === queryKey) keepPages(queryClient, pages);
      void queryClient.invalidateQueries(
        { queryKey },
        { cancelRefetch: false },
      );
    };

    const rest = (queryKey: Prefix, again: boolean) => {
      windows.set(queryKey, {
        again,
        timer: setTimeout(() => {
          const closing = windows.get(queryKey);
          windows.delete(queryKey);
          if (!active || !closing?.again) return;
          invalidate(queryKey);
          rest(queryKey, false);
        }, THROTTLE_MS),
      });
    };

    const changed = (queryKey: Prefix) => {
      const resting = windows.get(queryKey);
      if (resting) {
        resting.again = true;
        return;
      }
      // Asked before the invalidation starts reads of its own.
      const busy = queryClient.isFetching({ queryKey }) > 0;
      invalidate(queryKey);
      rest(queryKey, busy);
    };

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
      for (const queryKey of prefixes) changed(queryKey);
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
            if (!active) return;
            // Everything is read again: the signals still collected are
            // covered, and their flush would read the same families twice.
            clearTimeout(timer);
            timer = undefined;
            pending.clear();
            for (const resting of windows.values()) resting.again = false;
            for (const [, pages] of PAGED_LISTS) keepPages(queryClient, pages);
            void queryClient.invalidateQueries();
          },
        });
      })
      .catch(() => undefined);

    return () => {
      active = false;
      clearTimeout(timer);
      for (const resting of windows.values()) clearTimeout(resting.timer);
      windows.clear();
      unsubscribe?.();
    };
  }, [memberId, queryClient]);
}
