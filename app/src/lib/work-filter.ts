import { bucharestWallTimeToIso } from './calendar-time';
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
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
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
 * **Grup principal** options: every active top-level Group, the Organization
 * Group first and labelled OSUBB, the rest by name.
 */
export function rootGroups<G extends WorkFilterGroup>(
  groups: readonly G[],
): G[] {
  return groups
    .filter((group) => group.status === 'active' && group.path.length === 1)
    .map(labelled)
    .sort(
      (a, b) =>
        Number(Boolean(b.is_organization)) -
          Number(Boolean(a.is_organization)) ||
        collator.compare(a.name, b.name),
    );
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
  const names = new Map(groups.map((group) => [group.id, group.name]));
  const trail = (group: G) =>
    group.path.map((id) => names.get(id) ?? String(id));
  return groups
    .filter(
      (group) =>
        group.status === 'active' &&
        group.id !== rootId &&
        group.path.includes(rootId),
    )
    .map((group) => ({ group, trail: trail(group) }))
    .sort((a, b) => {
      for (let i = 0; i < Math.min(a.trail.length, b.trail.length); i += 1) {
        const order = collator.compare(a.trail[i] ?? '', b.trail[i] ?? '');
        if (order) return order;
      }
      return a.trail.length - b.trail.length;
    })
    .map(({ group }) => group);
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
