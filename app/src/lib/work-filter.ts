import { bucharestWallTimeToIso } from './calendar-time';
import { parsePositiveInt } from './ids';
import { dateRangeSchema, ISO_DAY } from './schemas/date-range';

/**
 * The Work Filter (`CONTEXT.md`, ruling R3, #678): a top-level Group, a Group
 * below it, a Campaign, and a date range. Choosing a Group means that Group and
 * every Group below it; the Campaign choices are those able to tag a Task in
 * the chosen Group. Its whole state lives in the URL, so a filtered page can be
 * shared, reloaded and deep-linked (R4's Acasă links write the same keys).
 *
 * Every field is optional: absent means unset, which means no bound.
 */
export type WorkFilterValue = {
  /** **Grup principal**: a top-level Group (the Organization included). */
  rootGroupId?: number;
  /** **Subgrup**: a Group anywhere below the root. */
  groupId?: number;
  /** **Campanie**. */
  campaignId?: number;
  /** **De la**, a Bucharest calendar day `YYYY-MM-DD`, inclusive. */
  from?: string;
  /** **Până la**, a Bucharest calendar day `YYYY-MM-DD`, inclusive. */
  to?: string;
};

export type WorkFilterLevel = keyof WorkFilterValue;

/**
 * The query-string key of each level. Romanian, because members read (and
 * share) these URLs, as they read the paths (`components/shell/navItems.ts`).
 * The order is the cascade's.
 */
export const WORK_FILTER_KEYS = {
  rootGroupId: 'grup',
  groupId: 'subgrup',
  campaignId: 'campanie',
  from: 'de_la',
  to: 'pana_la',
} as const satisfies Record<WorkFilterLevel, string>;

const LEVELS = Object.keys(WORK_FILTER_KEYS) as WorkFilterLevel[];

/**
 * What a change to a level invalidates: the Subgrup options depend on the
 * root, the Campaign options on the chosen Group. The date range narrows
 * nothing and depends on nothing, so no Group or Campaign change clears it.
 */
const DEPENDENTS: Record<WorkFilterLevel, readonly WorkFilterLevel[]> = {
  rootGroupId: ['groupId', 'campaignId'],
  groupId: ['campaignId'],
  campaignId: [],
  from: [],
  to: [],
};

function parseId(raw: string | null): number | undefined {
  return parsePositiveInt(raw) ?? undefined;
}

function parseDay(raw: string | null): string | undefined {
  if (!raw || !ISO_DAY.test(raw)) return undefined;
  const date = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === raw
    ? raw
    : undefined;
}

/** Read the Work Filter from a query string; a malformed key is unset. */
export function parseWorkFilter(params: URLSearchParams): WorkFilterValue {
  const value: WorkFilterValue = {
    rootGroupId: parseId(params.get(WORK_FILTER_KEYS.rootGroupId)),
    groupId: parseId(params.get(WORK_FILTER_KEYS.groupId)),
    campaignId: parseId(params.get(WORK_FILTER_KEYS.campaignId)),
    from: parseDay(params.get(WORK_FILTER_KEYS.from)),
    to: parseDay(params.get(WORK_FILTER_KEYS.to)),
  };
  for (const level of LEVELS)
    if (value[level] === undefined) delete value[level];
  return value;
}

/**
 * Write the Work Filter into a query string. Keys that are not the filter's
 * (a page's own tab or sort) are kept; an unset level has no key at all.
 */
export function serializeWorkFilter(
  value: WorkFilterValue,
  base: URLSearchParams = new URLSearchParams(),
): URLSearchParams {
  const params = new URLSearchParams(base);
  for (const level of LEVELS) {
    params.delete(WORK_FILTER_KEYS[level]);
    const current = value[level];
    if (current !== undefined && current !== '')
      params.set(WORK_FILTER_KEYS[level], String(current));
  }
  return params;
}

/** Change one level and clear every level that depended on it. */
export function setWorkFilterLevel<L extends WorkFilterLevel>(
  value: WorkFilterValue,
  level: L,
  next: WorkFilterValue[L] | undefined,
): WorkFilterValue {
  const result: WorkFilterValue = { ...value };
  if (next === undefined || next === '') delete result[level];
  else result[level] = next;
  if (next !== value[level])
    for (const dependent of DEPENDENTS[level]) delete result[dependent];
  return result;
}

/**
 * Choose a **Subgrup** together with the **Grup principal** it sits under
 * (#919): one write, so both URL keys (`grup`, `subgrup`) land together and
 * the chips and the rest of the cascade stay consistent. A changed root or
 * Group clears the Campaign, as `setWorkFilterLevel` does.
 */
export function setWorkFilterSubgroup(
  value: WorkFilterValue,
  rootGroupId: number,
  groupId: number,
): WorkFilterValue {
  return setWorkFilterLevel(
    setWorkFilterLevel(value, 'rootGroupId', rootGroupId),
    'groupId',
    groupId,
  );
}

/**
 * Which levels a page filters by; every level counts unless it is `false`.
 * `group: false` hides both Group levels (Grup principal and Subgrup) — the
 * Cupa Departamentelor ranks Groups, so a Group narrows nothing there (#823).
 * The page passes the same value to `useWorkFilter` and `<WorkFilter>`.
 */
export type WorkFilterLevels = {
  group?: boolean;
  campaign?: boolean;
  dates?: boolean;
};

/**
 * The filter a page actually applies: a level it hides is dropped even when
 * the URL carries it (a shared link from a page that shows it), so no hidden
 * key ever reaches the server or counts as active.
 */
export function visibleWorkFilter(
  value: WorkFilterValue,
  levels: WorkFilterLevels = {},
): WorkFilterValue {
  const visible = { ...value };
  if (levels.group === false) {
    delete visible.rootGroupId;
    delete visible.groupId;
  }
  if (levels.campaign === false) delete visible.campaignId;
  if (levels.dates === false) {
    delete visible.from;
    delete visible.to;
  }
  return visible;
}

/**
 * The levels a page hides that the URL carries: what **Șterge filtrele** keeps,
 * so clearing a view that hides the Group (the Cupa) leaves the Group for the
 * way back to the view that shows it.
 */
export function hiddenWorkFilter(
  value: WorkFilterValue,
  levels: WorkFilterLevels = {},
): WorkFilterValue {
  const visible = visibleWorkFilter(value, levels);
  const hidden: WorkFilterValue = {};
  for (const level of LEVELS)
    if (visible[level] === undefined && value[level] !== undefined)
      (hidden as Record<WorkFilterLevel, unknown>)[level] = value[level];
  return hidden;
}

/** Whether any level is set. */
export function isWorkFilterActive(value: WorkFilterValue): boolean {
  return LEVELS.some((level) => value[level] !== undefined);
}

/** The part of a Group the filter reads (`groups` or `my_groups()` rows). */
export type WorkFilterGroup = {
  id: number;
  name: string;
  path: readonly number[];
  status: string;
  is_organization?: boolean;
};

/** The part of a Campaign the filter reads. */
export type WorkFilterCampaign = { id: number; name: string; group_id: number };

/** The name a member knows a Group by: the Organization Group is OSUBB. */
export function workFilterGroupName(group: WorkFilterGroup): string {
  return group.is_organization ? 'OSUBB' : group.name;
}

function labelled<G extends WorkFilterGroup>(group: G): G {
  return group.is_organization ? { ...group, name: 'OSUBB' } : group;
}

const collator = new Intl.Collator('ro-RO', { sensitivity: 'base' });

/**
 * Where the **Grup principal** options start: `top-level` offers the
 * organization's top-level Groups; `topmost` offers every given Group with no
 * given Group above it — the page passes only the Groups the caller manages
 * (Campanii, R13), so a Team's Manager starts at the Team.
 */
export type WorkFilterRoots = 'top-level' | 'topmost';

/**
 * **Grup principal** options: every active top-level Group (or, `topmost`,
 * every active given Group with no given Group above it), the Organization
 * Group first and labelled OSUBB, the rest by name.
 */
export function rootGroups<G extends WorkFilterGroup>(
  groups: readonly G[],
  roots: WorkFilterRoots = 'top-level',
): G[] {
  const given = new Set(groups.map((group) => group.id));
  const isRoot = (group: G) =>
    roots === 'topmost'
      ? !group.path.some((id) => id !== group.id && given.has(id))
      : group.path.length === 1;
  return groups
    .filter((group) => group.status === 'active' && isRoot(group))
    .map(labelled)
    .sort(
      (a, b) =>
        Number(Boolean(b.is_organization)) -
          Number(Boolean(a.is_organization)) ||
        collator.compare(a.name, b.name),
    );
}

/**
 * One item a page can show (a Task, an Opportunity, an Event, a deadline),
 * reduced to what Rule W reads: its Group and its Campaign.
 */
export type WorkItem = { group_id: number; campaign_id: number | null };

function keptIds(keepIds: readonly (number | undefined)[]): number[] {
  return keepIds.filter((id): id is number => id !== undefined);
}

/**
 * Rule W for Groups (frontend QA, `relevance.md` §0): the Groups that own at
 * least one item the page can show, plus every Group above them — so the
 * cascade still reads top-down — plus the values already in the URL (and
 * theirs), so a shared link never loses its choice. A Group that owns
 * nothing (the Adunarea Generală with no Task and no Event, a Private Group)
 * is not offered.
 */
export function groupsWithWork<G extends WorkFilterGroup>(
  groups: readonly G[],
  ownerGroupIds: Iterable<number>,
  keepIds: readonly (number | undefined)[] = [],
): G[] {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const offered = new Set<number>();
  for (const id of [...ownerGroupIds, ...keptIds(keepIds)])
    for (const onPath of byId.get(id)?.path ?? [id]) offered.add(onPath);
  return groups.filter((group) => offered.has(group.id));
}

/**
 * Rule W for Campaigns: a Campaign is offered when it labels at least one
 * item the page can show, active or inactive, or when the URL already
 * carries it.
 */
export function campaignsWithWork<C extends WorkFilterCampaign>(
  campaigns: readonly C[],
  usedIds: Iterable<number | null>,
  keepIds: readonly (number | undefined)[] = [],
): C[] {
  const offered = new Set<number | null>([...usedIds, ...keptIds(keepIds)]);
  return campaigns.filter((campaign) => offered.has(campaign.id));
}

/**
 * The items under a chosen Group — that Group and every Group below it —
 * read through the Group tree; every item when no Group is chosen.
 */
export function itemsInGroup<I extends WorkItem>(
  items: readonly I[],
  groups: readonly WorkFilterGroup[],
  groupId: number | undefined,
): I[] {
  if (groupId === undefined) return [...items];
  const byId = new Map(groups.map((group) => [group.id, group]));
  return items.filter((item) =>
    (byId.get(item.group_id)?.path ?? [item.group_id]).includes(groupId),
  );
}

/**
 * The Group tree in reading order: each parent directly before its own
 * children, and siblings with the Organization Group first, then by name
 * (the order of **Grup principal**, one level at a time). `tree` names the
 * ancestors when `groups` leaves them out. The Subgrup options and the
 * Eveniment nou Group list both read it (F-15).
 */
export function inTreeOrder<G extends WorkFilterGroup>(
  groups: readonly G[],
  tree: readonly WorkFilterGroup[] = groups,
): G[] {
  const byId = new Map(tree.map((group) => [group.id, group]));
  const step = (id: number) => ({
    id,
    first: Boolean(byId.get(id)?.is_organization),
    name: byId.get(id)?.name ?? String(id),
  });
  return groups
    .map((group) => ({ group, trail: group.path.map(step) }))
    .sort((a, b) => {
      for (let i = 0; i < Math.min(a.trail.length, b.trail.length); i += 1) {
        const left = a.trail[i];
        const right = b.trail[i];
        if (!left || !right || left.id === right.id) continue;
        return (
          Number(right.first) - Number(left.first) ||
          collator.compare(left.name, right.name) ||
          left.id - right.id
        );
      }
      return a.trail.length - b.trail.length;
    })
    .map(({ group }) => group);
}

/**
 * **Subgrup** options: every active Group below the root, at any depth, in
 * tree order — each parent directly before its own children.
 */
export function groupsBelow<G extends WorkFilterGroup>(
  groups: readonly G[],
  rootId: number | undefined,
): G[] {
  if (rootId === undefined) return [];
  return inTreeOrder(
    groups.filter(
      (group) =>
        group.status === 'active' &&
        group.id !== rootId &&
        group.path.includes(rootId),
    ),
    groups,
  );
}

/**
 * **Subgrup** options with no Grup principal chosen (#919): every active
 * Group below any of the given roots, at any depth, in tree order.
 */
export function groupsBelowAny<G extends WorkFilterGroup>(
  groups: readonly G[],
  roots: readonly WorkFilterGroup[],
): G[] {
  const rootIds = new Set(roots.map((root) => root.id));
  return inTreeOrder(
    groups.filter(
      (group) =>
        group.status === 'active' &&
        !rootIds.has(group.id) &&
        group.path.some((id) => rootIds.has(id)),
    ),
    groups,
  );
}

/** The Grup principal a Subgrup option sits under, among the root options. */
export function rootOf(
  group: WorkFilterGroup,
  roots: readonly WorkFilterGroup[],
): number | undefined {
  return roots.find((root) => group.path.includes(root.id))?.id;
}

/**
 * **Campanie** options for the chosen Group (the Subgrup when set, else the
 * root): the Campaigns able to tag a Task there — owned by the Group itself or
 * one of its ancestors (`campaign.group_id ∈ chosen.path`, the predicate
 * `private.validate_task_campaign` enforces) — plus those owned anywhere below
 * it, because a Group in the Work Filter means that Group and everything below
 * it (#677's documented rule). With no Group chosen, every Campaign.
 */
export function campaignsFor<C extends WorkFilterCampaign>(
  campaigns: readonly C[],
  groups: readonly WorkFilterGroup[],
  groupId: number | undefined,
): C[] {
  if (groupId === undefined) return [...campaigns];
  const byId = new Map(groups.map((group) => [group.id, group]));
  const chosenPath = byId.get(groupId)?.path ?? [groupId];
  return campaigns.filter(
    (campaign) =>
      chosenPath.includes(campaign.group_id) ||
      (byId.get(campaign.group_id)?.path.includes(groupId) ?? false),
  );
}

/** What the Work Filter offers at each level, and which levels it renders. */
export type WorkFilterChoices<
  G extends WorkFilterGroup,
  C extends WorkFilterCampaign,
> = {
  roots: G[];
  below: G[];
  campaigns: C[];
  showRoot: boolean;
  showSub: boolean;
  showCampaign: boolean;
  /**
   * The root the Subgrup options hang from: the chosen one, or — when the
   * Grup principal level is hidden because it has one option — that option.
   * Unset, the Subgrup options span every root (#919), and choosing one sets
   * its root too (`setWorkFilterSubgroup`).
   */
  rootId: number | undefined;
};

/**
 * **Subgrup** options: below the chosen (or only) root, or — with none —
 * below every root option (#919), so the level is offered before a Grup
 * principal is chosen.
 */
function subgroupOptions<G extends WorkFilterGroup>(
  groups: readonly G[],
  rootOptions: readonly G[],
  rootId: number | undefined,
): G[] {
  return rootId === undefined
    ? groupsBelowAny(groups, rootOptions)
    : groupsBelow(groups, rootId);
}

/**
 * Whether the **Subgrup** level is drawn under Rule W (#919): with no root,
 * whenever any Subgrup is offered — several roots are shown, so even one
 * narrows. Under a root, when there are several, when the URL's Subgrup is
 * among them (its control never vanishes), or when the lone one leaves out
 * some of the root's items (those the root owns itself); a lone Subgrup
 * holding everything the root shows would narrow nothing.
 */
function subgroupNarrows(
  work: readonly WorkItem[],
  groups: readonly WorkFilterGroup[],
  value: WorkFilterValue,
  rootId: number | undefined,
  below: readonly WorkFilterGroup[],
): boolean {
  if (rootId === undefined) return below.length > 0;
  const [lone, ...rest] = below;
  if (!lone) return false;
  if (rest.length > 0 || below.some((group) => group.id === value.groupId))
    return true;
  const underRoot = itemsInGroup(work, groups, rootId);
  return itemsInGroup(underRoot, groups, lone.id).length < underRoot.length;
}

/**
 * The options of every level. With `work` (the items the page can show),
 * Rule W applies: only Groups and Campaigns with work are offered, the URL's
 * values are kept, and a level with one option or none is hidden — one
 * option means the page already shows only that Group or Campaign. Without
 * `work` (Campanii, R13: the caller's managed Groups), every given option
 * is offered and every level is drawn, bar a Subgrup with no option.
 */
export function workFilterChoices<
  G extends WorkFilterGroup,
  C extends WorkFilterCampaign,
>(
  groups: readonly G[],
  campaigns: readonly C[],
  value: WorkFilterValue,
  {
    work,
    roots = 'top-level',
  }: { work?: readonly WorkItem[]; roots?: WorkFilterRoots } = {},
): WorkFilterChoices<G, C> {
  if (!work) {
    const rootOptions = rootGroups(groups, roots);
    const below = subgroupOptions(groups, rootOptions, value.rootGroupId);
    return {
      roots: rootOptions,
      below,
      campaigns: campaignsFor(campaigns, groups, chosenGroupId(value)),
      showRoot: true,
      showSub: below.length > 0,
      showCampaign: true,
      rootId: value.rootGroupId,
    };
  }
  const offered = groupsWithWork(
    groups,
    work.map((item) => item.group_id),
    [value.rootGroupId, value.groupId],
  );
  const rootOptions = rootGroups(offered, roots);
  const rootId =
    value.rootGroupId ??
    (rootOptions.length === 1 ? rootOptions[0]?.id : undefined);
  const below = subgroupOptions(offered, rootOptions, rootId);
  const campaignOptions = campaignsWithWork(
    campaigns,
    itemsInGroup(work, groups, value.groupId ?? rootId).map(
      (item) => item.campaign_id,
    ),
    [value.campaignId],
  );
  return {
    roots: rootOptions,
    below,
    campaigns: campaignOptions,
    showRoot: rootOptions.length > 1,
    showSub: subgroupNarrows(work, groups, value, rootId, below),
    showCampaign: campaignOptions.length > 1,
    rootId,
  };
}

/**
 * The Work Filter value that places a chosen Group in the cascade: the root
 * it sits under (itself when it is one) and, below a root, the Subgrup. A
 * Group that is not among `groups` places nothing.
 */
export function placeGroup(
  groups: readonly WorkFilterGroup[],
  groupId: number | undefined,
  roots: WorkFilterRoots = 'top-level',
): Pick<WorkFilterValue, 'rootGroupId' | 'groupId'> {
  const chosen = groups.find((group) => group.id === groupId);
  if (!chosen) return {};
  const rootIds = new Set(rootGroups(groups, roots).map((group) => group.id));
  const rootId = chosen.path.find((id) => rootIds.has(id));
  if (rootId === undefined) return {};
  return rootId === chosen.id
    ? { rootGroupId: rootId }
    : { rootGroupId: rootId, groupId: chosen.id };
}

/** The Group a page filters by: the Subgrup when set, else the root. */
export function chosenGroupId(value: WorkFilterValue): number | undefined {
  return value.groupId ?? value.rootGroupId;
}

/** The message under **Până la** when the range is inverted, else `undefined`. */
export function dateRangeReason(value: WorkFilterValue): string | undefined {
  const result = dateRangeSchema.safeParse({ from: value.from, to: value.to });
  return result.success ? undefined : result.error.issues[0]?.message;
}

function followingDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function bucharestMidnight(day: string): string | undefined {
  // Romania's clock changes at 03:00/04:00, so every midnight exists.
  return bucharestWallTimeToIso(`${day}T00:00`) ?? undefined;
}

/**
 * The half-open instant range #677's readers take: **De la** at Bucharest
 * midnight as `p_from`, and the midnight after **Până la** as `p_to`, so the
 * last chosen day counts whole — 23 or 25 hours long across a DST change.
 */
export function rangeBounds(value: WorkFilterValue): {
  p_from?: string;
  p_to?: string;
} {
  const bounds: { p_from?: string; p_to?: string } = {};
  const from = value.from && bucharestMidnight(value.from);
  const to = value.to && bucharestMidnight(followingDay(value.to));
  if (from) bounds.p_from = from;
  if (to) bounds.p_to = to;
  return bounds;
}

/** The RPC arguments every Work Filter reader shares (#677). */
export type WorkFilterParams = {
  p_group_id?: number;
  p_campaign_id?: number;
  p_from?: string;
  p_to?: string;
};

/**
 * The RPC arguments for a filter, with unset levels left out — or `null` when
 * the range is inverted, so a page sends nothing the server would refuse.
 */
export function workFilterParams(
  value: WorkFilterValue,
): WorkFilterParams | null {
  if (dateRangeReason(value)) return null;
  const params: WorkFilterParams = { ...rangeBounds(value) };
  const groupId = chosenGroupId(value);
  if (groupId !== undefined) params.p_group_id = groupId;
  if (value.campaignId !== undefined) params.p_campaign_id = value.campaignId;
  return params;
}

/**
 * The arguments for a reader that takes no Group — the Cup ranks Groups, so
 * the Group level narrows only the board beside it.
 */
export function withoutGroup(
  params: WorkFilterParams,
): Omit<WorkFilterParams, 'p_group_id'> {
  const rest: Omit<WorkFilterParams, 'p_group_id'> = {};
  if (params.p_campaign_id !== undefined)
    rest.p_campaign_id = params.p_campaign_id;
  if (params.p_from !== undefined) rest.p_from = params.p_from;
  if (params.p_to !== undefined) rest.p_to = params.p_to;
  return rest;
}

/** The part of a Task row the filter reads when a page narrows its own list. */
export type WorkFilterTask = {
  group_id: number;
  /** The Task's Group, embedded; `path` runs from the root to the Group. */
  group?: { path: readonly number[] } | null;
  campaign_id: number | null;
  deadline: string | null;
};

/**
 * Whether a Task the page already holds passes the filter — the rules #677's
 * readers apply on the server, applied to a list the page read whole
 * (Disponibile, De gestionat, Toate): the Group means that Group and every
 * Group below it (its id is on the Task's Group `path`), the Campaign is
 * exact, and the half-open range reads the deadline, so an undated Task is
 * outside any range. A Task whose Group embed RLS withheld matches the Group
 * level only by its own id.
 */
export function matchesWorkFilter(
  task: WorkFilterTask,
  params: WorkFilterParams,
): boolean {
  if (params.p_group_id !== undefined) {
    const path = task.group?.path ?? [task.group_id];
    if (!path.includes(params.p_group_id)) return false;
  }
  if (
    params.p_campaign_id !== undefined &&
    task.campaign_id !== params.p_campaign_id
  )
    return false;
  if (params.p_from === undefined && params.p_to === undefined) return true;
  const deadline = task.deadline ? Date.parse(task.deadline) : Number.NaN;
  if (!Number.isFinite(deadline)) return false;
  if (params.p_from !== undefined && deadline < Date.parse(params.p_from))
    return false;
  if (params.p_to !== undefined && deadline >= Date.parse(params.p_to))
    return false;
  return true;
}
