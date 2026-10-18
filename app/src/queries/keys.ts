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
        /* R43: the board on the caller's Grupuri preferate. */
        p_preferred?: boolean;
      } | null,
    ) => ['points', 'leadership', memberId, filters] as const,
    /* #906: one Member's total on Trackerul membrului, under the same filter. */
    leadershipMember: (
      memberId: string | undefined,
      targetId: string,
      filters: {
        p_group_id?: number;
        p_campaign_id?: number;
        p_from?: string;
        p_to?: string;
      } | null,
    ) => ['points', 'leadership-member', memberId, targetId, filters] as const,
    leadershipCup: (
      memberId: string | undefined,
      filters: {
        p_campaign_id?: number;
        p_from?: string;
        p_to?: string;
      } | null,
    ) => ['points', 'leadership-cup', memberId, filters] as const,
    me: (memberId: string | undefined) =>
      ['points', 'me', { memberId }] as const,
    standing: (memberId: string | undefined) =>
      ['points', 'standing', { memberId }] as const,
    /* #634, #828: the Membership Cutoff Date (R58) and my own standing for
       one Role Evaluation kind (points since its last run, its threshold in
       force). Under `points` so an Evaluation's invalidation moves the bar
       too. */
    promotionProgress: (memberId: string | undefined, kind: string) =>
      ['points', 'promotion-progress', { memberId, kind }] as const,
    /* Every viewer's bar: a threshold change moves them all (#827). */
    promotionProgressAll: ['points', 'promotion-progress'] as const,
  },
  profile: {
    all: ['profile'] as const,
    me: (memberId: string | undefined) =>
      ['profile', 'me', { memberId }] as const,
    groups: (memberId: string | undefined) =>
      ['profile', 'groups', { memberId }] as const,
    roleHistory: (memberId: string | undefined) =>
      ['profile', 'roleHistory', { memberId }] as const,
  },
  /* Other members as the viewer may see them. Keyed by viewer too: what a
     profile shows depends on who is looking (contact details, rosters). */
  members: {
    all: ['members'] as const,
    card: (memberId: string, viewerId: string | undefined) =>
      ['members', 'card', { memberId, viewerId }] as const,
    /** A Member's Administrare page (#103): card, status and ledger rows. */
    admin: (memberId: string, viewerId: string | undefined) =>
      ['members', 'admin', { memberId, viewerId }] as const,
    /** A Member's Role History on their Administrare page (#932). */
    roleHistory: (memberId: string, viewerId: string | undefined) =>
      ['members', 'roleHistory', { memberId, viewerId }] as const,
    /** Whether a Member ever signed in (#773), read by `reinvite-member`. */
    invitation: (memberId: string, viewerId: string | undefined) =>
      ['members', 'invitation', { memberId, viewerId }] as const,
    /** Avatar colour and Voluntari chip for a set of Members (sorted ids). */
    identities: (viewerId: string | undefined, memberIds: readonly string[]) =>
      ['members', 'identities', { viewerId, memberIds }] as const,
    /** Nickname, full name and avatar colour for a set of Members (sorted ids). */
    names: (viewerId: string | undefined, memberIds: readonly string[]) =>
      ['members', 'names', { viewerId, memberIds }] as const,
    /** Members the import created and nobody invited yet (#992). */
    uninvited: (viewerId: string | undefined) =>
      ['members', 'uninvited', { viewerId }] as const,
  },
  /* Reference data — roles, Groups, the scoring guides. Same family for all of
     it: one `['reference']` invalidation after a deploy, or after Administrare
     changes a Group, is the whole cache-busting story (see `reference.ts`). */
  reference: {
    all: ['reference'] as const,
    groups: () => ['reference', 'groups'] as const,
    roles: () => ['reference', 'roles'] as const,
    evaluationScale: () => ['reference', 'evaluation-scale'] as const,
    difficultyLevels: () => ['reference', 'difficulty-levels'] as const,
  },
  tasks: {
    all: ['tasks'] as const,
    formOptions: (memberId: string | undefined) =>
      ['tasks', 'form-options', { memberId }] as const,
    directExecutors: (memberId: string | undefined) =>
      ['tasks', 'direct-executors', { memberId }] as const,
    /* #915: what "Adaugă task finalizat" and an approval choose from. Under
       `['tasks']`, so any Task or Group change refreshes them. */
    completedTaskOptions: (memberId: string | undefined) =>
      ['tasks', 'completed-options', { memberId }] as const,
    completedTaskGroups: (
      memberId: string | undefined,
      executorId: string | null,
    ) => ['tasks', 'completed-groups', { memberId, executorId }] as const,
    completedTaskExecutors: (
      memberId: string | undefined,
      groupId: number | null,
    ) => ['tasks', 'completed-executors', { memberId, groupId }] as const,
    memberHistory: (
      memberId: string | undefined,
      targetId: string,
      // The deadline range (#677); null while the Work Filter's is inverted.
      range: { p_from?: string; p_to?: string } | null = {},
    ) => ['tasks', 'member-history', memberId, targetId, range] as const,
    /* Taskurile mele's OPEN Tasks (ruling R55): Acasă reads them too. */
    mine: (memberId: string | undefined) =>
      ['tasks', 'mine', { memberId }] as const,
    /* The Member's own Tasks whose deadline is in a range: the Calendar's month. */
    mineRange: (
      memberId: string | undefined,
      range: { from: string; to: string } | null,
    ) => ['tasks', 'mine-range', { memberId }, range] as const,
    /* Whether one Task is in Taskurile mele, finished or not: a `?task=` link. */
    isMine: (taskId: number | null, memberId: string | undefined) =>
      ['tasks', 'is-mine', { taskId, memberId }] as const,
    open: () => ['tasks', 'open'] as const,
    // R57: which Opportunities the Member may join depends on their Role
    // level, so a promotion is a different Disponibile.
    available: (memberId: string | undefined, level?: number) =>
      ['tasks', 'available', { memberId, level }] as const,
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
    /* #1017: what "Șterge definitiv" would take back, read as the dialog opens. */
    deletePreview: (taskId: number, memberId: string | undefined) =>
      ['tasks', 'delete-preview', { taskId, memberId }] as const,
    /* The OPEN Tasks I manage (#1053): De gestionat, Acasă's De evaluat. */
    managed: (memberId: string | undefined) =>
      ['tasks', 'managed', { memberId }] as const,
    /* The finished Tasks of a list, by the page, under its filters:
       De gestionat, Toate, Taskurile mele (Disponibile has none). */
    finished: (
      memberId: string | undefined,
      list: 'managed' | 'all' | 'mine',
      filters: Record<string, unknown>,
    ) => ['tasks', 'finished', { memberId, list }, filters] as const,
    /* Every finished part, whatever its list and filters: a live change
       keeps only their first pages (live-changes.ts). */
    finishedAll: ['tasks', 'finished'] as const,
    /* What a list holds: Groups, Campaigns, states, counts. */
    summary: (
      memberId: string | undefined,
      list: 'managed' | 'all' | 'mine' | 'available',
    ) => ['tasks', 'summary', { memberId, list }] as const,
    /* The managed Tasks whose deadline is in a range: the Calendar's month. */
    managedRange: (
      memberId: string | undefined,
      range: { from: string; to: string } | null,
    ) => ['tasks', 'managed-range', { memberId }, range] as const,
    /* `can_manage_task` for one Task, as the viewer. */
    manageCapability: (taskId: number | null, memberId: string | undefined) =>
      ['tasks', 'manage-capability', { taskId, memberId }] as const,
    /* Whether RLS lets the viewer read one Task. */
    readable: (taskId: number | null, memberId: string | undefined) =>
      ['tasks', 'readable', { taskId, memberId }] as const,
    /* Tasks where I hold a pending candidature (the Calendar's chips, #692). */
    candidatures: (memberId: string | undefined) =>
      ['tasks', 'candidatures', { memberId }] as const,
    leadershipCapability: (memberId: string | undefined) =>
      ['tasks', 'leadership-capability', { memberId }] as const,
    /* The OPEN Tasks I read as leadership (Toate). */
    leadership: (memberId: string | undefined) =>
      ['tasks', 'all', { memberId }] as const,
    byDept: (dept: string) => ['tasks', { dept }] as const,
  },
  campaigns: {
    all: ['campaigns'] as const,
    list: (memberId: string | undefined, groupId?: number) =>
      ['campaigns', { memberId, groupId }] as const,
    report: (
      memberId: string | undefined,
      campaignId: number,
      range: { p_from?: string; p_to?: string } = {},
    ) => ['campaigns', 'report', { memberId, campaignId, ...range }] as const,
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
    /* #1017: what deleting a Group for good would take with it. */
    deletePreview: (groupId: number, memberId: string | undefined) =>
      ['groups', 'delete-preview', { groupId, memberId }] as const,
    /* Whom a Group may appoint: every member the caller can see at all. */
    appointable: (memberId: string | undefined) =>
      ['groups', 'appointable', { memberId }] as const,
    mine: (memberId: string | undefined) =>
      ['groups', 'mine', { memberId }] as const,
    /* R43: Grupuri preferate -- every Group the member can see, selected or
       not, and why a Group is locked. Under `['groups']`, so a new Group or a
       new position refreshes it. */
    preferences: (memberId: string | undefined) =>
      ['groups', 'preferences', { memberId }] as const,
    /* The Work Filter's Group and Campaign choices on the Tracker. */
    filterOptions: (memberId: string | undefined) =>
      ['groups', 'filter-options', { memberId }] as const,
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
  /* The Cereri de aprobare (spec 2026-10-11): one list for both kinds. */
  approvals: {
    all: ['approvals'] as const,
    list: (memberId: string | undefined) =>
      ['approvals', 'list', { memberId }] as const,
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
    /* Every readable Event's Group and Campaign, any date: the Calendar's
       Work Filter offers only those (Rule W, #845). */
    work: (memberId: string | undefined) =>
      ['events', 'work', { memberId }] as const,
    rsvp: (eventId: number, memberId: string) =>
      ['events', 'rsvp', { eventId, memberId }] as const,
    /* Every answer on one Event, which only its managers read (#934). */
    attendance: (eventId: number, memberId: string | undefined) =>
      ['events', 'attendance', { eventId, memberId }] as const,
    /* The Events I answered "Vin" to: an Other OSUBB Event turns to colour. */
    going: (memberId: string) => ['events', 'going', { memberId }] as const,
  },
  announcements: {
    all: ['announcements'] as const,
    /* Every page of the Anunțuri feed, whatever its filters: a change reads
       every loaded page again, and marking one read changes its row in place
       rather than reading them again (R56). */
    feedAll: ['announcements', 'feed'] as const,
    /* The feed under the Group filter and Grupuri preferate, 20 a page. */
    feed: (
      memberId: string | undefined,
      filters: { p_group_id?: number; p_preferred?: boolean },
    ) => ['announcements', 'feed', { memberId }, filters] as const,
    /* What the page shows around its feed: the unread count of the header,
       the critical banner, the empty states. */
    feedSummaryAll: ['announcements', 'feed-summary'] as const,
    feedSummary: (
      memberId: string | undefined,
      filters: { p_group_id?: number; p_preferred?: boolean },
    ) => ['announcements', 'feed-summary', { memberId }, filters] as const,
    /* One Announcement by its id, through RLS: a `?anunt=` link, the banner
       or a Cerere de aprobare whose row is not among the loaded pages. */
    one: (announcementId: number, memberId: string | undefined) =>
      ['announcements', 'one', { announcementId, memberId }] as const,
    /* The Anunțuri badge. Under `['announcements']`, so marking one read
       refreshes the badge with everything else the read changes. */
    unread: (memberId: string | undefined) =>
      ['announcements', 'unread', { memberId }] as const,
    readers: (announcementId: number, memberId: string | undefined) =>
      ['announcements', 'readers', { announcementId, memberId }] as const,
    /* OSUBB Deals (R45): Announcements of kind deal, with the viewer's own
       reveals. Under `['announcements']`, so a read or a reveal refreshes
       them with the feed and the badge. */
    deals: (memberId: string | undefined) =>
      ['announcements', 'deals', { memberId }] as const,
    dealReveals: (announcementId: number, memberId: string | undefined) =>
      ['announcements', 'deal-reveals', { announcementId, memberId }] as const,
  },
  /* The OSUBB Deals team (R44/R47). */
  assignments: {
    all: ['assignments'] as const,
    team: (memberId: string | undefined) =>
      ['assignments', 'team', { memberId }] as const,
  },
  /* Leadership page support reads (the metrics themselves live under points
     and tasks, so evaluations refresh them). */
  leadership: {
    all: ['leadership'] as const,
    filters: (memberId: string | undefined) =>
      ['leadership', 'filters', { memberId }] as const,
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
    /* #1012: the subjects of the member's unread Notifications -- what a
       screen opening a thing checks before it reads them. */
    subjects: (memberId?: string) =>
      ['notifications', 'subjects', { memberId }] as const,
  },
  /* The Privacy Notice (#771): whether the member still has to acknowledge
     the current version ("mine"), BC's list of every active Member's latest
     acknowledgement, and one Member's for their Administrare page. One
     `['privacy']` prefix, so an acknowledgement refreshes all three. */
  privacy: {
    all: ['privacy'] as const,
    gate: (memberId: string | undefined) =>
      ['privacy', 'gate', { memberId }] as const,
    status: (viewerId: string | undefined) =>
      ['privacy', 'status', { viewerId }] as const,
    member: (memberId: string, viewerId: string | undefined) =>
      ['privacy', 'member', { memberId, viewerId }] as const,
  },
  /* Role Evaluations and what they decide (#826, #827; ruling R28; R58): the
     runs, the two Promotion Thresholds and their log, the open Promotion
     Candidates, the open Retention Signals, a run's ranking and the two
     shares x and y (#866). One
     `['evaluation']` prefix, so a run, a threshold or share edit or a
     rejection refreshes all of them at once. */
  evaluation: {
    all: ['evaluation'] as const,
    roleEvaluations: (memberId: string | undefined) =>
      ['evaluation', 'role-evaluations', { memberId }] as const,
    thresholds: (memberId: string | undefined) =>
      ['evaluation', 'thresholds', { memberId }] as const,
    thresholdChanges: (memberId: string | undefined) =>
      ['evaluation', 'threshold-changes', { memberId }] as const,
    candidates: (memberId: string | undefined) =>
      ['evaluation', 'candidates', { memberId }] as const,
    /* The ranking of one finalised run, recomputed from its recorded values
       (R58); `null` while no run is chosen. A Simulation is not cached. */
    ranking: (runId: number | null, memberId: string | undefined) =>
      ['evaluation', 'ranking', runId, { memberId }] as const,
    /* The open stored Retention Signals (R58). */
    signals: (memberId: string | undefined) =>
      ['evaluation', 'signals', { memberId }] as const,
    percents: (memberId: string | undefined) =>
      ['evaluation', 'percents', { memberId }] as const,
    /* The evaluation settings (R58): the Eligibility Floor, the Membership
       Cutoff and the Points Start Date. One row, read by every Member. */
    settings: (memberId: string | undefined) =>
      ['evaluation', 'settings', { memberId }] as const,
  },
  /* The organization settings (#681): every row, read by every Member. */
  orgSettings: {
    all: ['org-settings'] as const,
    list: (memberId: string | undefined) =>
      ['org-settings', { memberId }] as const,
  },
  /* Whether this browser receives Web Push for the member (#704): its
     subscription and its `push_tokens` row. "Mine", so keyed by member. */
  push: {
    device: (memberId: string | undefined) =>
      ['push', 'device', { memberId }] as const,
    /* The member's per-kind push preferences (#635), for all their devices. */
    preferences: (memberId: string | undefined) =>
      ['push', 'preferences', { memberId }] as const,
  },
} as const;
