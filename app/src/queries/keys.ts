/**
 * Query keys, in one place.
 *
 * Two rules make caching behave (mini-spec §5):
 *
 *  1. **Keys mirror the data, not the screen.** `['points','leaderboard',{ limit }]`, not
 *     `['dashboard','leaderboardCard']`. Two screens showing the same thing then
 *     share one cache entry and one request, and a change in one is a change in
 *     both — for free.
 *  2. **Most general first**, so a prefix invalidates a family. After grading a
 *     task, `invalidateQueries({ queryKey: keys.points.all })` refreshes the
 *     member's total, the leaderboard and the cup together, because all three
 *     start with `['points']`. Invalidating each leaf by hand is how one of
 *     them ends up stale.
 *  3. **Self data is keyed by member.** Anything that answers "mine" carries
 *     `{ memberId }` so two members on one device never share an entry; the
 *     provider also clears the cache when the member changes.
 */
export const keys = {
  /* The live capability row (`my_capabilities()`): "mine", so keyed by member. */
  capabilities: (memberId: string | undefined) =>
    ['capabilities', { memberId }] as const,
  points: {
    all: ['points'] as const,
    leadership: (
      memberId: string | undefined,
      // The Work Filter's RPC arguments (#678); null while its range is invalid.
      filters: {
        p_group_id?: number;
        p_campaign_id?: number;
        p_from?: string;
        p_to?: string;
      } | null,
    ) => ['points', 'leadership', memberId, filters] as const,
    leadershipCup: (
      memberId: string | undefined,
      filters: {
        p_campaign_id?: number;
        p_from?: string;
        p_to?: string;
      } | null,
    ) => ['points', 'leadership-cup', memberId, filters] as const,
    board: (memberId: string | undefined) =>
      ['points', 'board', { memberId }] as const,
    me: (memberId: string | undefined) =>
      ['points', 'me', { memberId }] as const,
    standing: (memberId: string | undefined) =>
      ['points', 'standing', { memberId }] as const,
    leaderboard: (limit = 10) => ['points', 'leaderboard', { limit }] as const,
    deptCup: () => ['points', 'deptCup'] as const,
  },
  profile: {
    all: ['profile'] as const,
    me: (memberId: string | undefined) =>
      ['profile', 'me', { memberId }] as const,
    groups: (memberId: string | undefined) =>
      ['profile', 'groups', { memberId }] as const,
  },
  /* Other members as the viewer may see them. Keyed by viewer too: what a
     profile shows depends on who is looking (contact details, rosters). */
  members: {
    all: ['members'] as const,
    card: (memberId: string, viewerId: string | undefined) =>
      ['members', 'card', { memberId, viewerId }] as const,
  },
  /* Reference data — roles, Groups, the scoring guides. Same family for all of
     it: one `['reference']` invalidation after a deploy, or after Administrare
     changes a Group, is the whole cache-busting story (see `reference.ts`). */
  reference: {
    all: ['reference'] as const,
    groups: () => ['reference', 'groups'] as const,
    roles: () => ['reference', 'roles'] as const,
    evaluationScale: () => ['reference', 'evaluation-scale'] as const,
  },
  tasks: {
    all: ['tasks'] as const,
    formOptions: (memberId: string | undefined) =>
      ['tasks', 'form-options', { memberId }] as const,
    directExecutors: (memberId: string | undefined) =>
      ['tasks', 'direct-executors', { memberId }] as const,
    memberHistory: (memberId: string | undefined, targetId: string) =>
      ['tasks', 'member-history', memberId, targetId] as const,
    mine: (memberId: string | undefined) =>
      ['tasks', 'mine', { memberId }] as const,
    open: () => ['tasks', 'open'] as const,
    available: (memberId: string | undefined) =>
      ['tasks', 'available', { memberId }] as const,
    scopes: (memberId: string | undefined) =>
      ['tasks', 'scopes', { memberId }] as const,
    queue: (taskId: number, memberId: string | undefined) =>
      ['tasks', 'queue', { taskId, memberId }] as const,
    candidates: (taskId: number, memberId: string | undefined) =>
      ['tasks', 'candidates', { taskId, memberId }] as const,
    history: (taskId: number, memberId: string | undefined) =>
      ['tasks', 'history', { taskId, memberId }] as const,
    detail: (taskId: number, memberId: string | undefined) =>
      ['tasks', 'detail', { taskId, memberId }] as const,
    managed: (memberId: string | undefined) =>
      ['tasks', 'managed', { memberId }] as const,
    /* Tasks where I hold a pending candidature (the Calendar's chips, #692). */
    candidatures: (memberId: string | undefined) =>
      ['tasks', 'candidatures', { memberId }] as const,
    leadershipCapability: (memberId: string | undefined) =>
      ['tasks', 'leadership-capability', { memberId }] as const,
    leadership: (memberId: string | undefined) =>
      ['tasks', 'all', { memberId }] as const,
    byDept: (dept: string) => ['tasks', { dept }] as const,
  },
  campaigns: {
    all: ['campaigns'] as const,
    list: (memberId: string | undefined, groupId?: number) =>
      ['campaigns', { memberId, groupId }] as const,
    report: (memberId: string | undefined, campaignId: number) =>
      ['campaigns', 'report', { memberId, campaignId }] as const,
  },
  /* Administrare's own reads: the Group tree with its settings and member
     counts, and one Group's roster. They start with `['groups']`, so every
     Group command invalidates the family with a single prefix. */
  groups: {
    all: ['groups'] as const,
    tree: (memberId: string | undefined) =>
      ['groups', 'tree', { memberId }] as const,
    roster: (groupId: number, memberId: string | undefined) =>
      ['groups', 'roster', { groupId, memberId }] as const,
    /* Whom a Group may appoint: every member the caller can see at all. */
    appointable: (memberId: string | undefined) =>
      ['groups', 'appointable', { memberId }] as const,
    mine: (memberId: string | undefined) =>
      ['groups', 'mine', { memberId }] as const,
  },
  requests: {
    decisions: (memberId: string | undefined) =>
      ['requests', 'decisions', { memberId }] as const,
    all: ['requests'] as const,
    origins: (memberId: string | undefined) =>
      ['requests', 'origins', { memberId }] as const,
    mine: (memberId: string | undefined) =>
      ['requests', 'mine', { memberId }] as const,
  },
  events: {
    all: ['events'] as const,
    formOptions: (memberId: string | undefined) =>
      ['events', 'form-options', { memberId }] as const,
    /* The Calendar's window on `starts_at` (#692), and Acasă's (#700). */
    range: (memberId: string, range: { from?: string; to?: string }) =>
      [
        'events',
        'range',
        { memberId, from: range.from, to: range.to },
      ] as const,
    detail: (eventId: number, memberId: string) =>
      ['events', 'detail', { eventId, memberId }] as const,
    rsvp: (eventId: number, memberId: string) =>
      ['events', 'rsvp', { eventId, memberId }] as const,
    /* The Events I answered "Vin" to: an Other OSUBB Event turns to colour. */
    going: (memberId: string) => ['events', 'going', { memberId }] as const,
  },
  announcements: {
    all: ['announcements'] as const,
    feed: (memberId?: string) =>
      ['announcements', 'feed', { memberId }] as const,
  },
  /* Leadership page support reads (the metrics themselves live under points
     and tasks, so evaluations refresh them). */
  leadership: {
    all: ['leadership'] as const,
    filters: (memberId: string | undefined) =>
      ['leadership', 'filters', { memberId }] as const,
    memberName: (memberId: string | undefined, targetId: string) =>
      ['leadership', 'member-name', { memberId, targetId }] as const,
  },
  notifications: {
    all: ['notifications'] as const,
    /* The Notification centre and its badge are both "mine", so both carry the
       member (rule 3) and both start with `['notifications']`: marking one row
       read refreshes the list and the badge from a single invalidation. */
    list: (memberId: string | undefined) =>
      ['notifications', 'list', { memberId }] as const,
    unread: (memberId?: string) =>
      ['notifications', 'unread', { memberId }] as const,
  },
} as const;
