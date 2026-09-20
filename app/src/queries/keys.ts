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
  points: {
    all: ['points'] as const,
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
  },
  /* Reference data — roles, Groups, the scoring guides. Same family for all of
     it: one `['reference']` invalidation after a deploy, or after Administrare
     changes a Group, is the whole cache-busting story (see `reference.ts`). */
  reference: {
    all: ['reference'] as const,
    groups: () => ['reference', 'groups'] as const,
    roles: () => ['reference', 'roles'] as const,
  },
  tasks: {
    all: ['tasks'] as const,
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
    management: (memberId: string | undefined) =>
      ['tasks', 'management', { memberId }] as const,
    leadershipCapability: (memberId: string | undefined) =>
      ['tasks', 'leadership-capability', { memberId }] as const,
    leadership: (memberId: string | undefined) =>
      ['tasks', 'all', { memberId }] as const,
    byDept: (dept: string) => ['tasks', { dept }] as const,
  },
  requests: {
    all: ['requests'] as const,
    origins: (memberId: string | undefined) =>
      ['requests', 'origins', { memberId }] as const,
    mine: (memberId: string | undefined) =>
      ['requests', 'mine', { memberId }] as const,
  },
  events: {
    all: ['events'] as const,
    upcoming: (memberId: string) =>
      ['events', 'upcoming', { memberId }] as const,
    rsvp: (eventId: number, memberId: string) =>
      ['events', 'rsvp', { eventId, memberId }] as const,
  },
  announcements: {
    all: ['announcements'] as const,
    feed: (memberId?: string) =>
      ['announcements', 'feed', { memberId }] as const,
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
