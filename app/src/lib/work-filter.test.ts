import { describe, expect, it } from 'vitest';
import {
  matchesWorkFilter,
  campaignsFor,
  groupsBelow,
  groupsBelowAny,
  parseWorkFilter,
  placeGroup,
  rangeBounds,
  rootGroups,
  rootOf,
  serializeWorkFilter,
  setWorkFilterLevel,
  setWorkFilterSubgroup,
  hiddenWorkFilter,
  visibleWorkFilter,
  workFilterParams,
  campaignsWithWork,
  groupsWithWork,
  itemsInGroup,
  workFilterChoices,
  type WorkFilterCampaign,
  type WorkFilterGroup,
} from './work-filter';

/*
 * Three levels under Educațional (1): Mentorat (2) → Grupa A (3), with a
 * sibling Traineri (4) beside Mentorat and an archived Arhivă (6). OSUBB (5)
 * is the Organization Group, stored under its legacy name.
 */
const groups: WorkFilterGroup[] = [
  { id: 2, name: 'Mentorat', path: [1, 2], status: 'active' },
  { id: 3, name: 'Grupa A', path: [1, 2, 3], status: 'active' },
  { id: 1, name: 'Educațional', path: [1], status: 'active' },
  { id: 4, name: 'Traineri', path: [1, 4], status: 'active' },
  {
    id: 5,
    name: 'Organizația',
    path: [5],
    status: 'active',
    is_organization: true,
  },
  { id: 6, name: 'Arhivă', path: [1, 6], status: 'archived' },
  { id: 7, name: 'Vechi', path: [7], status: 'archived' },
  { id: 8, name: 'Comunicare', path: [8], status: 'active' },
];
const campaigns: WorkFilterCampaign[] = [
  { id: 10, name: 'Pe ancestor', group_id: 1 },
  { id: 11, name: 'Pe grup', group_id: 2 },
  { id: 12, name: 'Pe descendent', group_id: 3 },
  { id: 13, name: 'Pe frate', group_id: 4 },
  { id: 14, name: 'Pe alt grup principal', group_id: 5 },
];
const ids = (rows: readonly { id: number }[]) => rows.map((row) => row.id);

describe('parseWorkFilter / serializeWorkFilter', () => {
  it('round-trips every level through the Romanian query keys', () => {
    const query =
      'grup=3&subgrup=7&campanie=12&de_la=2026-09-01&pana_la=2026-09-30';
    const value = parseWorkFilter(new URLSearchParams(query));
    expect(value).toEqual({
      rootGroupId: 3,
      groupId: 7,
      campaignId: 12,
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(serializeWorkFilter(value).toString()).toBe(query);
  });

  it('reads an absent or malformed key as unset, and writes no key for it', () => {
    expect(
      parseWorkFilter(
        new URLSearchParams(
          'grup=abc&subgrup=0&campanie=-4&de_la=2026-02-30&pana_la=30.09.2026',
        ),
      ),
    ).toEqual({});
    expect(serializeWorkFilter({}).toString()).toBe('');
  });

  it("keeps a page's own query keys beside the filter", () => {
    const base = new URLSearchParams('tab=arhiva&grup=1&campanie=9');
    expect(serializeWorkFilter({ rootGroupId: 2 }, base).toString()).toBe(
      'tab=arhiva&grup=2',
    );
  });
});

describe('setWorkFilterLevel', () => {
  const full = {
    rootGroupId: 1,
    groupId: 2,
    campaignId: 11,
    from: '2026-09-01',
    to: '2026-09-30',
  };

  it('clears the Subgrup and Campaign when the root changes or is cleared', () => {
    expect(setWorkFilterLevel(full, 'rootGroupId', 8)).toEqual({
      rootGroupId: 8,
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(setWorkFilterLevel(full, 'rootGroupId', undefined)).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    });
  });

  it('clears the Campaign when the Subgrup changes, and nothing above it', () => {
    expect(setWorkFilterLevel(full, 'groupId', 3)).toEqual({
      rootGroupId: 1,
      groupId: 3,
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(setWorkFilterLevel(full, 'groupId', undefined)).toEqual({
      rootGroupId: 1,
      from: '2026-09-01',
      to: '2026-09-30',
    });
  });

  it('leaves the other levels alone for a Campaign or a date, and for no change', () => {
    expect(setWorkFilterLevel(full, 'campaignId', undefined)).toEqual({
      ...full,
      campaignId: undefined,
    });
    expect(setWorkFilterLevel(full, 'to', '')).not.toHaveProperty('to');
    expect(setWorkFilterLevel(full, 'rootGroupId', 1)).toEqual(full);
  });
});

describe('setWorkFilterSubgroup (#919)', () => {
  it('sets both Group keys in one write and clears the Campaign, keeping the dates', () => {
    const value = setWorkFilterSubgroup(
      { campaignId: 14, from: '2026-09-01' },
      1,
      3,
    );
    expect(value).toEqual({ rootGroupId: 1, groupId: 3, from: '2026-09-01' });
    expect(serializeWorkFilter(value).toString()).toBe(
      'grup=1&subgrup=3&de_la=2026-09-01',
    );
  });

  it('keeps the Campaign when neither Group changes', () => {
    const full = { rootGroupId: 1, groupId: 3, campaignId: 12 };
    expect(setWorkFilterSubgroup(full, 1, 3)).toEqual(full);
  });
});

describe('Group options', () => {
  it('offers every active top-level Group, OSUBB first and labelled OSUBB', () => {
    const roots = rootGroups(groups);
    expect(ids(roots)).toEqual([5, 8, 1]);
    expect(roots.map((group) => group.name)).toEqual([
      'OSUBB',
      'Comunicare',
      'Educațional',
    ]);
  });

  it('offers every active Group below the root, at any depth, in tree order', () => {
    expect(ids(groupsBelow(groups, 1))).toEqual([2, 3, 4]);
    expect(groupsBelow(groups, 8)).toEqual([]);
    expect(groupsBelow(groups, undefined)).toEqual([]);
  });
  it('offers every active Group below any root, in tree order, with no root chosen (#919)', () => {
    const roots = rootGroups(groups);
    expect(ids(groupsBelowAny(groups, roots))).toEqual([2, 3, 4]);
    expect(rootOf(groups[1] as WorkFilterGroup, roots)).toBe(1);
    // Only Comunicare as a root: nothing below it.
    expect(groupsBelowAny(groups, roots.slice(1, 2))).toEqual([]);
  });

  it('roots a managed-only list at its topmost Groups (Campanii, R13)', () => {
    // A Manager of Mentorat and of Comunicare: no top-level Educațional.
    const managed = groups.filter((group) => [2, 3, 8].includes(group.id));
    expect(ids(rootGroups(managed))).toEqual([8]);
    expect(ids(rootGroups(managed, 'topmost'))).toEqual([8, 2]);
    expect(ids(groupsBelow(managed, 2))).toEqual([3]);
  });
});

describe('placeGroup', () => {
  const managed = groups.filter((group) => [2, 3, 8].includes(group.id));

  it('places a root alone and a Group below it under its root', () => {
    expect(placeGroup(managed, 2, 'topmost')).toEqual({ rootGroupId: 2 });
    expect(placeGroup(managed, 3, 'topmost')).toEqual({
      rootGroupId: 2,
      groupId: 3,
    });
    expect(placeGroup(groups, 3)).toEqual({ rootGroupId: 1, groupId: 3 });
  });

  it('places nothing for a Group outside the list or no Group', () => {
    expect(placeGroup(managed, 1, 'topmost')).toEqual({});
    expect(placeGroup(managed, undefined, 'topmost')).toEqual({});
  });
});

describe('campaignsFor', () => {
  it('offers the Campaigns on the chosen Group, its ancestors and its descendants', () => {
    // Mentorat: its ancestor's, its own and its child's — never its sibling's.
    expect(ids(campaignsFor(campaigns, groups, 2))).toEqual([10, 11, 12]);
    // The leaf sees what can tag its own Tasks: its path.
    expect(ids(campaignsFor(campaigns, groups, 3))).toEqual([10, 11, 12]);
    expect(ids(campaignsFor(campaigns, groups, 4))).toEqual([10, 13]);
    // A root means everything below it.
    expect(ids(campaignsFor(campaigns, groups, 1))).toEqual([10, 11, 12, 13]);
    expect(ids(campaignsFor(campaigns, groups, 5))).toEqual([14]);
  });

  it('offers every Campaign with no Group chosen', () => {
    expect(ids(campaignsFor(campaigns, groups, undefined))).toEqual([
      10, 11, 12, 13, 14,
    ]);
  });
});

describe('Rule W', () => {
  // A level-3 viewer reads the Adunarea Generală (9), which owns nothing.
  const withAg: WorkFilterGroup[] = [
    ...groups,
    { id: 9, name: 'Adunarea Generală', path: [9], status: 'active' },
  ];
  // One Task deep under Educațional (Grupa A), one in Comunicare.
  const work = [
    { group_id: 3, campaign_id: 12 },
    { group_id: 8, campaign_id: null },
  ];

  it('offers a Group with an item deep below it, with every ancestor, and never one with none', () => {
    expect(ids(groupsWithWork(withAg, [3, 8]))).toEqual([2, 3, 1, 8]);
    expect(ids(groupsWithWork(withAg, [3, 8]))).not.toContain(9);
  });

  it('keeps a Group the URL already carries, with its ancestors, though it owns nothing', () => {
    expect(ids(groupsWithWork(withAg, [8], [9, undefined]))).toEqual([8, 9]);
    expect(ids(groupsWithWork(withAg, [], [4]))).toEqual([1, 4]);
  });

  it('offers a Campaign that labels an item, or that the URL carries', () => {
    expect(ids(campaignsWithWork(campaigns, [12, null]))).toEqual([12]);
    expect(ids(campaignsWithWork(campaigns, [12], [14]))).toEqual([12, 14]);
  });

  it('reads the items under a chosen Group through the tree', () => {
    expect(itemsInGroup(work, groups, 1)).toEqual([work[0]]);
    expect(itemsInGroup(work, groups, undefined)).toEqual(work);
  });

  it('offers the roots with work, never the Adunarea Generală with none', () => {
    const choices = workFilterChoices(withAg, campaigns, {}, { work });
    expect(ids(choices.roots)).toEqual([8, 1]);
    expect(choices.showRoot).toBe(true);
    // No root chosen: every Subgrup with work below any root (#919) —
    // one Subgrup narrows, since two roots are shown.
    expect(ids(choices.below)).toEqual([2, 3]);
    expect(choices.showSub).toBe(true);
    expect(choices.rootId).toBeUndefined();
    // One Campaign labels an item: the level is hidden.
    expect(ids(choices.campaigns)).toEqual([12]);
    expect(choices.showCampaign).toBe(false);
  });

  it('hides a one-option level and hangs the Subgrup from its only root', () => {
    const deep = [
      { group_id: 3, campaign_id: 11 },
      { group_id: 4, campaign_id: 13 },
    ];
    const choices = workFilterChoices(withAg, campaigns, {}, { work: deep });
    expect(ids(choices.roots)).toEqual([1]);
    expect(choices.showRoot).toBe(false);
    expect(choices.rootId).toBe(1);
    // Mentorat, Grupa A and Traineri: the Subgrup level stays.
    expect(ids(choices.below)).toEqual([2, 3, 4]);
    expect(choices.showSub).toBe(true);
    expect(ids(choices.campaigns)).toEqual([11, 13]);
    expect(choices.showCampaign).toBe(true);
  });

  it('narrows the Subgrup options to the chosen root, and hides a lone one that narrows nothing (#919)', () => {
    const spread = [
      { group_id: 2, campaign_id: null },
      { group_id: 4, campaign_id: null },
      { group_id: 8, campaign_id: null },
    ];
    const withSub: WorkFilterGroup[] = [
      ...withAg,
      { id: 20, name: 'Social media', path: [8, 20], status: 'active' },
    ];
    const everyRoot = workFilterChoices(
      withSub,
      campaigns,
      {},
      { work: [...spread, { group_id: 20, campaign_id: null }] },
    );
    expect(ids(everyRoot.below)).toEqual([20, 2, 4]);
    const underOne = workFilterChoices(
      withSub,
      campaigns,
      { rootGroupId: 1 },
      { work: [...spread, { group_id: 20, campaign_id: null }] },
    );
    expect(ids(underOne.below)).toEqual([2, 4]);
    expect(underOne.showSub).toBe(true);
    // Under Comunicare only Social media, holding all its items: not drawn.
    const onlySub = [
      ...spread.slice(0, 2),
      { group_id: 20, campaign_id: null },
    ];
    const lone = workFilterChoices(
      withSub,
      campaigns,
      { rootGroupId: 8 },
      { work: onlySub },
    );
    expect(ids(lone.below)).toEqual([20]);
    expect(lone.showSub).toBe(false);
    // Comunicare owning a Task itself: Social media narrows, so it is drawn.
    expect(
      workFilterChoices(
        withSub,
        campaigns,
        { rootGroupId: 8 },
        { work: [...spread, { group_id: 20, campaign_id: null }] },
      ).showSub,
    ).toBe(true);
    // A chosen lone Subgrup keeps its control.
    expect(
      workFilterChoices(
        withSub,
        campaigns,
        { rootGroupId: 8, groupId: 20 },
        { work: onlySub },
      ).showSub,
    ).toBe(true);
  });

  it('hides the Subgrup when no option has a Group below a root (#919)', () => {
    const flat = [
      { group_id: 1, campaign_id: null },
      { group_id: 8, campaign_id: null },
    ];
    const choices = workFilterChoices(withAg, campaigns, {}, { work: flat });
    expect(choices.below).toEqual([]);
    expect(choices.showSub).toBe(false);
  });

  it('narrows the Campaigns to the items under the chosen Group', () => {
    const both = [
      { group_id: 3, campaign_id: 11 },
      { group_id: 4, campaign_id: 13 },
      { group_id: 8, campaign_id: null },
    ];
    expect(
      ids(
        workFilterChoices(
          groups,
          campaigns,
          { rootGroupId: 1, groupId: 4 },
          { work: both },
        ).campaigns,
      ),
    ).toEqual([13]);
  });

  it('keeps a URL-chosen Group with no item among the options', () => {
    const choices = workFilterChoices(
      withAg,
      campaigns,
      { rootGroupId: 9 },
      { work },
    );
    expect(ids(choices.roots)).toEqual([9, 8, 1]);
  });

  it('offers every given option and draws every level without work (Campanii)', () => {
    const choices = workFilterChoices(withAg, campaigns, {});
    expect(ids(choices.roots)).toEqual([5, 9, 8, 1]);
    // No root chosen: every Group below one (#919).
    expect(ids(choices.below)).toEqual([2, 3, 4]);
    expect([choices.showRoot, choices.showSub, choices.showCampaign]).toEqual([
      true,
      true,
      true,
    ]);
    // A root with nothing below it: the Subgrup is not drawn, never disabled.
    expect(
      workFilterChoices(withAg, campaigns, { rootGroupId: 8 }).showSub,
    ).toBe(false);
  });
});

describe('rangeBounds', () => {
  it('sends Bucharest midnight of De la and the midnight after Până la', () => {
    expect(rangeBounds({ from: '2026-09-01', to: '2026-09-30' })).toEqual({
      p_from: '2026-08-31T21:00:00.000Z',
      p_to: '2026-09-30T21:00:00.000Z',
    });
    expect(rangeBounds({})).toEqual({});
    expect(rangeBounds({ to: '2026-12-31' })).toEqual({
      p_to: '2026-12-31T22:00:00.000Z',
    });
  });

  it('keeps the chosen day whole across a DST change', () => {
    // 25 October 2026: clocks go back, the day lasts 25 hours.
    expect(rangeBounds({ from: '2026-10-25', to: '2026-10-25' })).toEqual({
      p_from: '2026-10-24T21:00:00.000Z',
      p_to: '2026-10-25T22:00:00.000Z',
    });
    // 29 March 2026: clocks go forward, the day lasts 23 hours.
    expect(rangeBounds({ from: '2026-03-29', to: '2026-03-29' })).toEqual({
      p_from: '2026-03-28T22:00:00.000Z',
      p_to: '2026-03-29T21:00:00.000Z',
    });
  });
});

describe('workFilterParams', () => {
  it('sends no argument for an unset level', () => {
    expect(workFilterParams({})).toEqual({});
  });

  it('filters by the Subgrup when set, else the root, with the Campaign and range', () => {
    expect(
      workFilterParams({
        rootGroupId: 1,
        groupId: 2,
        campaignId: 11,
        from: '2026-09-01',
        to: '2026-09-30',
      }),
    ).toEqual({
      p_group_id: 2,
      p_campaign_id: 11,
      p_from: '2026-08-31T21:00:00.000Z',
      p_to: '2026-09-30T21:00:00.000Z',
    });
    expect(workFilterParams({ rootGroupId: 1 })).toEqual({ p_group_id: 1 });
  });

  it('sends nothing for an inverted range', () => {
    expect(
      workFilterParams({
        rootGroupId: 1,
        from: '2026-09-30',
        to: '2026-09-01',
      }),
    ).toBeNull();
  });
});

describe('visibleWorkFilter', () => {
  it('drops the levels a page hides and keeps the rest', () => {
    const value = {
      rootGroupId: 1,
      campaignId: 10,
      from: '2026-09-01',
      to: '2026-09-30',
    };
    expect(visibleWorkFilter(value)).toEqual(value);
    expect(visibleWorkFilter(value, { campaign: false })).toEqual({
      rootGroupId: 1,
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(visibleWorkFilter(value, { dates: false })).toEqual({
      rootGroupId: 1,
      campaignId: 10,
    });
  });

  it('drops both Group levels when the page hides the Group (the Cupa view)', () => {
    const value = {
      rootGroupId: 1,
      groupId: 2,
      campaignId: 10,
      from: '2026-09-01',
    };
    expect(visibleWorkFilter(value, { group: false })).toEqual({
      campaignId: 10,
      from: '2026-09-01',
    });
    // What clearing keeps: exactly the hidden levels the URL carries.
    expect(hiddenWorkFilter(value, { group: false })).toEqual({
      rootGroupId: 1,
      groupId: 2,
    });
    expect(hiddenWorkFilter(value)).toEqual({});
  });
});

describe('matchesWorkFilter', () => {
  const task = {
    group_id: 3,
    group: { path: [1, 2, 3] },
    campaign_id: 11,
    deadline: '2026-09-15T20:59:00Z',
  };
  it('matches the chosen Group and every Group above the Task’s own', () => {
    expect(matchesWorkFilter(task, {})).toBe(true);
    expect(matchesWorkFilter(task, { p_group_id: 1 })).toBe(true);
    expect(matchesWorkFilter(task, { p_group_id: 3 })).toBe(true);
    expect(matchesWorkFilter(task, { p_group_id: 4 })).toBe(false);
    // A withheld Group embed matches only by its own id.
    expect(matchesWorkFilter({ ...task, group: null }, { p_group_id: 1 })).toBe(
      false,
    );
    expect(matchesWorkFilter({ ...task, group: null }, { p_group_id: 3 })).toBe(
      true,
    );
  });
  it('matches the Campaign exactly', () => {
    expect(matchesWorkFilter(task, { p_campaign_id: 11 })).toBe(true);
    expect(matchesWorkFilter(task, { p_campaign_id: 12 })).toBe(false);
  });
  it('reads the deadline against the half-open Bucharest range; undated is outside', () => {
    const day = workFilterParams({ from: '2026-09-15', to: '2026-09-15' });
    expect(day).not.toBeNull();
    if (!day) return;
    expect(matchesWorkFilter(task, day)).toBe(true);
    expect(
      matchesWorkFilter({ ...task, deadline: '2026-09-15T21:00:00Z' }, day),
    ).toBe(false);
    expect(
      matchesWorkFilter({ ...task, deadline: '2026-09-14T20:59:59Z' }, day),
    ).toBe(false);
    expect(matchesWorkFilter({ ...task, deadline: null }, day)).toBe(false);
  });
});
