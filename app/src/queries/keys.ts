/**
 * Query keys, in one place.
 *
 * Two rules make caching behave (mini-spec §5):
 *
 *  1. **Keys mirror the data, not the screen.** `['points','leaderboard']`, not
 *     `['dashboard','leaderboardCard']`. Two screens showing the same thing then
 *     share one cache entry and one request, and a change in one is a change in
 *     both — for free.
 *  2. **Most general first**, so a prefix invalidates a family. After grading a
 *     task, `invalidateQueries({ queryKey: keys.points.all })` refreshes the
 *     member's total, the leaderboard and the cup together, because all three
 *     start with `['points']`. Invalidating each leaf by hand is how one of
 *     them ends up stale.
 */
export const keys = {
  points: {
    all: ['points'] as const,
    me: () => ['points', 'me'] as const,
    leaderboard: () => ['points', 'leaderboard'] as const,
    deptCup: () => ['points', 'deptCup'] as const,
  },
  tasks: {
    all: ['tasks'] as const,
    mine: () => ['tasks', 'mine'] as const,
    open: () => ['tasks', 'open'] as const,
    byDept: (dept: string) => ['tasks', { dept }] as const,
  },
  events: {
    all: ['events'] as const,
    upcoming: () => ['events', 'upcoming'] as const,
  },
  announcements: {
    all: ['announcements'] as const,
    feed: () => ['announcements', 'feed'] as const,
  },
  notifications: {
    all: ['notifications'] as const,
    unread: () => ['notifications', 'unread'] as const,
  },
} as const;
