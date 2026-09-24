import { describe, expect, it } from 'vitest';
import {
  matchesWorkFilter,
  campaignsFor,
  groupsBelow,
  parseWorkFilter,
  rangeBounds,
  rootGroups,
  serializeWorkFilter,
  setWorkFilterLevel,
  visibleWorkFilter,
  workFilterParams,
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
