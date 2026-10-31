import { beforeEach, describe, expect, it, vi } from 'vitest';
import { taskRow } from '../test/task-fixtures';
import { postgrest, type FakeRequest } from '../test/postgrest-fake';

vi.mock('../lib/supabase', async () => ({
  supabase: (await import('../test/postgrest-fake')).postgrest.client,
}));

import {
  ANNOUNCEMENT_PAGE,
  announcementFeedQueryOptions,
  fetchAnnouncementFeedPage,
  fetchAnnouncementReaders,
  type AnnouncementFeedPage,
  type FeedPageParam,
} from './announcements';
import { fetchPendingCandidatureTasks } from './calendar-tasks';
import { fetchCampaignReport } from './campaigns';
import { fetchMyCompletedWorkRequests } from './completed-work-requests';
import { fetchDeals } from './deals';
import { fetchEventAttendance } from './event-attendance';
import { fetchEventFormOptions } from './event-creation';
import { fetchGoingEventIds } from './event-rsvp';
import { fetchEventsInRange } from './events';
import { fetchUnreadNotificationSubjects } from './notifications';
import { fetchPrivacyStatus } from './privacy';
import { fetchGroups } from './reference';
import {
  fetchPromotionCandidates,
  fetchRetentionSignals,
  fetchRoleEvaluationRanking,
  fetchThresholdChanges,
  simulateRoleEvaluation,
} from './role-evaluations';
import { fetchTaskOpportunities } from './task-opportunities';
import {
  fetchOpenTasks,
  fetchTaskListSummary,
  type TaskListRpcRow,
} from './task-lists';
import { fetchUninvitedMembers } from './volunteer-import';

/*
 * #1058: every read that can pass 500 rows reads them by pages. The fake
 * answers as PostgREST does — 500 rows a request at most, silently — so each
 * read is handed 501 rows and must return the 501st. Each also orders by a
 * unique column last, so no row is skipped or repeated across pages.
 */

const ROWS = 501;
const many = <T>(make: (index: number) => T) =>
  Array.from({ length: ROWS }, (_, index) => make(index));

/** The orders of one request on its own rows, not on an embed's. */
function orders(request: FakeRequest | undefined) {
  return postgrest
    .argsOf(request, 'order')
    .filter(
      ([, options]) =>
        !(options as { referencedTable?: string } | undefined)?.referencedTable,
    );
}

/** The ids one request asked for by `.in('id', …)`; none for any other read. */
function idsAsked(request: FakeRequest) {
  const asked = postgrest
    .argsOf(request, 'in')
    .find(([column]) => column === 'id');
  return (asked?.[1] ?? []) as unknown[];
}

const ranked = (index: number) => ({
  member_id: `member-${index}`,
  role: 'activ',
  task_points: ROWS - index,
  ranked: true,
  rank: index + 1,
  evaluated_count: ROWS,
  ranked_count: ROWS,
  share_size: 50,
  line: ROWS - 49,
  inside: index < 50,
  listable: false,
});

beforeEach(() => postgrest.reset());

describe('Administrare', () => {
  it('ranks a Role Evaluation cohort past 500 Members', async () => {
    postgrest.serve('role_evaluation_ranking', many(ranked));
    const ranking = await fetchRoleEvaluationRanking(12);
    expect(ranking).toHaveLength(ROWS);
    expect(ranking.at(-1)).toMatchObject({
      memberId: 'member-500',
      rank: 501,
    });
    expect(orders(postgrest.requestsTo('role_evaluation_ranking')[0])).toEqual([
      ['task_points', { ascending: false }],
      ['member_id'],
    ]);
  });

  it('simulates a Role Evaluation over a population past 500 Members', async () => {
    postgrest.serve('simulate_role_evaluation', many(ranked));
    const rows = await simulateRoleEvaluation({
      kind: 'voluntar_activ',
      from: '2026-02-01',
      to: '2026-07-31',
      floor: 10,
      percent: 35,
      cutoff: '2026-03-01',
    });
    expect(rows).toHaveLength(ROWS);
    expect(rows.at(-1)).toMatchObject({ memberId: 'member-500', rank: 501 });
    expect(orders(postgrest.requestsTo('simulate_role_evaluation')[0])).toEqual(
      [['task_points', { ascending: false }], ['member_id']],
    );
  });

  it('lists every active Member’s privacy acknowledgement (#1136)', async () => {
    postgrest.serve('org_settings', [{ value: '1.3' }]);
    postgrest.serve(
      'privacy_acknowledgement_status',
      many((index) => ({
        member_id: `member-${String(index).padStart(3, '0')}`,
        notice_version: null,
        acknowledged_at: null,
      })),
    );
    const status = await fetchPrivacyStatus();
    expect(status.rows).toHaveLength(ROWS);
    expect(status.rows.at(-1)?.memberId).toBe('member-500');
    expect(
      orders(postgrest.requestsTo('privacy_acknowledgement_status')[0]),
    ).toEqual([['member_id']]);
  });

  it('lists every open Retention Signal', async () => {
    postgrest.serve(
      'retention_signals',
      many((index) => ({
        id: index,
        kind: 'voluntar_activ',
        member_id: `member-${index}`,
        role_at_listing: 'activ',
        reason: 'below_line',
        task_points: index,
        threshold_used: 600,
        role_evaluation_id: 1,
        created_at: '2026-10-01T10:00:00Z',
      })),
    );
    await expect(fetchRetentionSignals()).resolves.toHaveLength(ROWS);
    expect(orders(postgrest.requestsTo('retention_signals')[0])).toEqual([
      ['kind', { ascending: true }],
      ['task_points', { ascending: true }],
      ['id', { ascending: true }],
    ]);
  });

  it('fails the ranking whole when a later page fails', async () => {
    const failure = new Error('offline');
    // The first page lands; the one after it fails.
    postgrest.serve('role_evaluation_ranking', (request) =>
      (postgrest.argsOf(request, 'range')[0]?.[0] ?? 0) === 0
        ? many(ranked)
        : failure,
    );
    await expect(fetchRoleEvaluationRanking(12)).rejects.toBe(failure);
  });

  it('lists every open Promotion Candidate', async () => {
    postgrest.serve(
      'promotion_candidates',
      many((index) => ({
        id: index,
        member_id: `member-${index}`,
        task_points: 900 - index,
        tenure_since: '2025-10-01',
        threshold_used: 100,
        created_at: '2026-10-01T10:00:00Z',
        role_evaluation_id: null,
        role_evaluation: null,
      })),
    );
    await expect(fetchPromotionCandidates()).resolves.toHaveLength(ROWS);
    expect(orders(postgrest.requestsTo('promotion_candidates')[0])).toEqual([
      ['task_points', { ascending: false }],
      ['id', { ascending: true }],
    ]);
  });

  it('reads the whole threshold log', async () => {
    postgrest.serve(
      'promotion_threshold_changes',
      many((index) => ({ id: index })),
    );
    await expect(fetchThresholdChanges()).resolves.toHaveLength(ROWS);
  });

  it('lists every Member not yet invited, in sheet order', async () => {
    postgrest.serve(
      'uninvited_members',
      many((index) => ({
        member_id: `member-${index}`,
        full_name: `Membru ${index}`,
        email: `membru${index}@example.com`,
        phone: null,
        role: 'recrut',
        memberships: [],
        problems: [],
        sheet_row: index + 2,
      })),
    );
    const members = await fetchUninvitedMembers();
    expect(members).toHaveLength(ROWS);
    expect(members.at(-1)?.memberId).toBe('member-500');
    expect(orders(postgrest.requestsTo('uninvited_members')[0])).toEqual([
      ['sheet_row'],
      ['full_name'],
      ['member_id'],
    ]);
  });
});

describe('Taskuri', () => {
  /** `task_list` as the server pages it: by `p_offset` and `p_limit`. */
  function serveTaskList(rows: readonly TaskListRpcRow[]) {
    postgrest.serve('task_list', (request) => {
      const { p_offset, p_limit } = request.args as {
        p_offset: number;
        p_limit: number;
      };
      return rows.slice(p_offset, p_offset + p_limit);
    });
  }
  const listed = (index: number): TaskListRpcRow => ({
    ...taskRow({
      id: index,
      assignment_mode: 'public',
      audience: 'org',
    }),
    min_level: 0,
    assignments: [],
    evaluations: [],
    submission: [],
    executor: null,
    // Every other one a pending Candidature, its queue since closed.
    my_candidature: index % 2 ? 'pending' : null,
    queue_closed_at: index % 2 ? '2026-10-01T00:00:00Z' : null,
    total: ROWS,
  });
  const offsets = () =>
    postgrest
      .requestsTo('task_list')
      .map((request) => (request.args as { p_offset: number }).p_offset);

  it('keeps every open Task of a Member past 500 (Taskurile mele)', async () => {
    serveTaskList(many(listed));
    const tasks = await fetchOpenTasks('mine');
    expect(tasks).toHaveLength(ROWS);
    expect(tasks.at(-1)?.id).toBe(500);
    expect(offsets()).toEqual([0, 500]);
  });

  it('offers every available Task and keeps every pending Candidature in Disponibile', async () => {
    postgrest.serve('my_groups', []);
    serveTaskList(many(listed));
    const offered = await fetchTaskOpportunities('member');
    const ids = new Set(offered.map((task) => task.id));
    expect(ids.size).toBe(ROWS);
    expect(ids.has(499)).toBe(true);
    expect(ids.has(500)).toBe(true);
    expect(offsets()).toEqual([0, 500]);
  });

  it('summarises a list whose Groups, Campaigns and states pass 500', async () => {
    postgrest.serve(
      'task_list_summary',
      many((index) => ({
        group_id: index,
        campaign_id: null,
        status: 'completed',
        late: false,
        dated: true,
        tasks: 1,
      })),
    );
    await expect(fetchTaskListSummary('managed')).resolves.toHaveLength(ROWS);
    // One row per Group, Campaign, state, lateness and date: the whole key.
    expect(orders(postgrest.requestsTo('task_list_summary')[0])).toEqual([
      ['group_id'],
      ['campaign_id'],
      ['status'],
      ['late'],
      ['dated'],
    ]);
  });

  it('reads every Completed-work Request of a Member', async () => {
    postgrest.serve(
      'completed_work_requests',
      many((index) => ({ id: index, status: 'approved' })),
    );
    await expect(fetchMyCompletedWorkRequests('member')).resolves.toHaveLength(
      ROWS,
    );
    expect(orders(postgrest.requestsTo('completed_work_requests')[0])).toEqual([
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
    ]);
  });
});

describe('Calendar', () => {
  it('reads every Event of the window', async () => {
    postgrest.serve(
      'events',
      many((index) => ({
        id: index,
        title: `Eveniment ${index}`,
        type: 'sedinta',
        group_id: 7,
        starts_at: '2026-11-02T16:00:00.000Z',
        ends_at: null,
        location: null,
        capacity: null,
        description: null,
        min_level: 0,
        created_by: null,
        cancelled_at: null,
        cancel_reason: null,
        campaign_id: null,
        group: null,
      })),
    );
    const events = await fetchEventsInRange({ from: '2026-10-13T21:00:00Z' });
    expect(events).toHaveLength(ROWS);
    expect(orders(postgrest.requestsTo('events')[0])).toEqual([
      ['starts_at', { ascending: true }],
      ['id'],
    ]);
  });

  it('reads every Event a Member goes to', async () => {
    postgrest.serve(
      'event_attendance',
      many((index) => ({ event_id: index })),
    );
    await expect(fetchGoingEventIds('member')).resolves.toHaveLength(ROWS);
    expect(orders(postgrest.requestsTo('event_attendance')[0])).toEqual([
      ['event_id'],
    ]);
  });

  it('reads every Task a Member is a pending Candidate on', async () => {
    postgrest.serve(
      'task_candidates',
      many((index) => ({
        task: {
          id: index,
          title: `Task ${index}`,
          status: 'todo',
          deadline: null,
          group_id: 1,
          campaign_id: null,
          group: null,
        },
      })),
    );
    await expect(fetchPendingCandidatureTasks('member')).resolves.toHaveLength(
      ROWS,
    );
    expect(orders(postgrest.requestsTo('task_candidates')[0])).toEqual([
      ['id'],
    ]);
  });

  it('reads every answer on an Event for the whole organization', async () => {
    postgrest.serve(
      'event_attendance',
      many((index) => ({ member_id: `member-${index}`, status: 'going' })),
    );
    const attendance = await fetchEventAttendance(42);
    expect(attendance.going).toHaveLength(ROWS);
    expect(orders(postgrest.requestsTo('event_attendance')[0])).toEqual([
      ['member_id'],
    ]);
  });
});

describe('Anunțuri and Deals', () => {
  // R56: the feed is read 20 at a time, in the server's order; every
  // Announcement past 500 is still reached, one page after another.
  it('reaches every Announcement by the page, never reading the table whole', async () => {
    const feed = many((index) => ({ id: index, read_at: null, total: ROWS }));
    postgrest.serve('announcement_feed', (request) => {
      const { p_limit, p_offset } = request.args as {
        p_limit: number;
        p_offset: number;
      };
      return feed.slice(p_offset, p_offset + p_limit);
    });
    const options = announcementFeedQueryOptions({}, 'member');
    const pages: AnnouncementFeedPage[] = [];
    let param: FeedPageParam | undefined = options.initialPageParam;
    while (param !== undefined) {
      const page = await fetchAnnouncementFeedPage({}, param);
      pages.push(page);
      param = options.getNextPageParam(page, pages);
    }
    expect(pages.flatMap((page) => page.rows)).toHaveLength(ROWS);
    expect(pages).toHaveLength(Math.ceil(ROWS / ANNOUNCEMENT_PAGE));
    expect(postgrest.requestsTo('announcements')).toEqual([]);
  });

  it('reads every reader of an Announcement for the whole organization', async () => {
    postgrest.serve(
      'announcement_readers',
      many((index) => ({ member_id: `member-${index}`, read_at: null })),
    );
    postgrest.serve('profiles_directory', (request) =>
      idsAsked(request).map((id) => ({
        id,
        full_name: `Membru ${String(id)}`,
        nickname: null,
        avatar_color: null,
      })),
    );
    const readers = await fetchAnnouncementReaders(7);
    expect(readers).toHaveLength(ROWS);
    expect(readers?.at(-1)?.member.fullName).toBe('Membru member-500');
    expect(orders(postgrest.requestsTo('announcement_readers')[0])).toEqual([
      ['read_at', { ascending: false, nullsFirst: false }],
      ['member_id'],
    ]);
  });

  it('reads every Deal', async () => {
    postgrest.serve(
      'announcements',
      many((index) => ({ id: index })),
    );
    await expect(fetchDeals()).resolves.toHaveLength(ROWS);
    expect(orders(postgrest.requestsTo('announcements')[0])).toEqual([
      ['published_at', { ascending: false }],
      ['id', { ascending: false }],
    ]);
  });
});

describe('Campanii', () => {
  it('reports every Executor of a Campaign', async () => {
    postgrest.serve('campaign_totals', [
      { points_total: 0, tasks_completed: 0, tasks_total: 0 },
    ]);
    postgrest.serve(
      'campaign_report',
      many((index) => ({
        member_id: `member-${index}`,
        full_name: `Membru ${index}`,
        nickname: null,
        points: ROWS - index,
        tasks_completed: 1,
      })),
    );
    const report = await fetchCampaignReport(3);
    expect(report.members).toHaveLength(ROWS);
    expect(orders(postgrest.requestsTo('campaign_report')[0])).toEqual([
      ['points', { ascending: false }],
      ['full_name'],
      ['member_id'],
    ]);
  });
});

describe('Groups and Notifications', () => {
  const group = (id: number) => ({
    id,
    name: `Grup ${id}`,
    short: null,
    color: null,
    category: 'department',
    path: [id],
    parent_id: null,
    min_level: 0,
    status: 'active',
    is_organization: false,
    is_private: false,
  });

  it('knows every Group past 500', async () => {
    postgrest.serve('groups', many(group));
    const groups = await fetchGroups();
    expect(groups.size).toBe(ROWS);
    expect(orders(postgrest.requestsTo('groups')[0])).toEqual([['id']]);
  });

  it('names every Group in the Event form', async () => {
    postgrest.serve('my_capabilities', [
      { create_top_level_groups: true, manages_any_group: true },
    ]);
    postgrest.serve('my_groups', []);
    postgrest.serve('campaigns', []);
    postgrest.serve('groups', many(group));
    const options = await fetchEventFormOptions();
    expect(options.groupNames).toHaveLength(ROWS);
    expect(orders(postgrest.requestsTo('groups')[0])).toEqual([['id']]);
  });

  it('reads the subject of every unread Notification', async () => {
    postgrest.serve(
      'notifications',
      many((index) => ({ subject: `task:${index}` })),
    );
    await expect(
      fetchUnreadNotificationSubjects('member'),
    ).resolves.toHaveLength(ROWS);
    expect(orders(postgrest.requestsTo('notifications')[0])).toEqual([['id']]);
  });
});
