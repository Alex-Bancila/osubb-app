import { Building2, Circle, Globe, Rocket, Users } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

// The membership rule (isMemberOf) lives beside the my_groups() read; no
// request is made, but the module loads the client.
vi.mock('../../lib/supabase', () => ({ supabase: {} }));

import type { CalendarTaskRow } from '../../queries/calendar-tasks';
import type { EventGroup, EventPresentation } from '../../queries/events';
import type { MyGroup } from '../../queries/my-groups';
import type { Group } from '../../queries/reference';
import {
  buildMonthGrid,
  calendarTasks,
  countLabel,
  dayCellLayout,
  daySummary,
  eventAccentColor,
  eventGroupIcon,
  eventGroupLabel,
  eventIsPast,
  eventRangeForDays,
  eventRelevance,
  eventTimeLabel,
  eventTypeLabel,
  filterEvents,
  filterTasks,
  gridBounds,
  groupEventsByDay,
  itemsByDay,
  layoutWeekBars,
  monthBounds,
  monthLabel,
  relevanceColor,
  relevantGroupIds,
  shiftMonth,
} from './calendar-presentation';

const osubbGroup: EventGroup = {
  name: 'OSUBB',
  short: 'ORG',
  color: '#ED2025',
  category: 'organization',
  path: [5],
  is_organization: true,
};

const eduGroup: EventGroup = {
  name: 'Educațional',
  short: 'EDU',
  color: '#284C93',
  category: 'department',
  path: [7],
  is_organization: false,
};

/** A Child Group: Social Media, under Educațional. */
const socialMediaGroup: EventGroup = {
  name: 'Social Media',
  short: null,
  color: null,
  category: 'team',
  path: [7, 12],
  is_organization: false,
};

/** An Independent Team: a top-level Group with no parent on its path. */
const logisticaGroup: EventGroup = {
  name: 'Logistică',
  short: null,
  color: null,
  category: 'team',
  path: [15],
  is_organization: false,
};

const festivalGroup: EventGroup = {
  name: 'Festivalul Studențesc 2026',
  short: null,
  color: null,
  category: 'project',
  path: [20],
  is_organization: false,
};

function event(overrides: Partial<EventPresentation> = {}): EventPresentation {
  return {
    id: 1,
    title: 'Ședință generală',
    type: 'sedinta',
    groupId: 5,
    group: osubbGroup,
    campaignId: null,
    startsAt: '2026-08-30T07:00:00.000Z',
    endsAt: null,
    dayKey: '2026-08-30',
    allDay: false,
    lastDayKey: overrides.dayKey ?? '2026-08-30',
    multiDay: false,
    dayLabel: 'duminică, 30 august 2026',
    startTime: '10:00',
    endTime: null,
    location: null,
    capacity: null,
    description: null,
    minLevel: 0,
    createdBy: null,
    cancelledAt: null,
    cancelReason: null,
    approvalStatus: 'approved',
    rejectionReason: null,
    ...overrides,
  };
}

function group(overrides: Partial<Group>): Group {
  return {
    id: 7,
    name: 'Educațional',
    short: 'EDU',
    color: '#284C93',
    category: 'department',
    path: [7],
    parent_id: null,
    min_level: 0,
    status: 'active',
    is_organization: false,
    ...overrides,
  };
}

const readableGroups = new Map<number, Group>([[7, group({})]]);

describe('groupEventsByDay', () => {
  it('groups events on the same Bucharest day and sorts them by instant', () => {
    const groups = groupEventsByDay([
      event({
        id: 2,
        startsAt: '2026-08-30T10:00:00.000Z',
        startTime: '13:00',
      }),
      event({
        id: 1,
        startsAt: '2026-08-30T07:00:00.000Z',
        startTime: '10:00',
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual({
      dayKey: '2026-08-30',
      dayLabel: 'duminică, 30 august 2026',
      events: expect.arrayContaining([]),
    });
    expect(groups[0]?.events.map(({ id }) => id)).toEqual([1, 2]);
  });

  it('keeps events across the UTC/Bucharest rollover in their mapped days', () => {
    const groups = groupEventsByDay([
      event(),
      event({
        id: 3,
        startsAt: '2026-08-30T21:30:00.000Z',
        dayKey: '2026-08-31',
        dayLabel: 'luni, 31 august 2026',
        startTime: '00:30',
      }),
    ]);

    expect(groups.map(({ dayKey }) => dayKey)).toEqual([
      '2026-08-30',
      '2026-08-31',
    ]);
  });

  it('returns no groups for an empty event list', () => {
    expect(groupEventsByDay([])).toEqual([]);
  });
});

describe('calendar labels', () => {
  it.each([
    ['sedinta', 'Ședință'],
    ['activitate', 'Activitate'],
    ['call', 'Call'],
    ['eveniment', 'Eveniment'],
    ['deadline', 'Deadline'],
    ['recrutare', 'Recrutare'],
  ] as const)('maps %s to its Romanian event label', (type, label) => {
    expect(eventTypeLabel(type)).toBe(label);
  });

  // Ruling of 2026-09-28 (B24): the Group's name, never its category. Mutations
  // this catches: read the parent from the wrong slot of `path` (the Child
  // Group loses its parent), or put a category noun back ("Proiect",
  // "Echipă"). Dropping the `is_organization` branch is the next test's job —
  // the Organization Group happens to be *named* OSUBB today, so this one
  // would stay green.
  it('labels an Event by its Group name, a Child Group with its parent', () => {
    expect(eventGroupLabel(event(), readableGroups)).toBe('OSUBB');
    expect(eventGroupLabel(event({ group: eduGroup }), readableGroups)).toBe(
      'Educațional',
    );
    expect(
      eventGroupLabel(event({ group: socialMediaGroup }), readableGroups),
    ).toBe('Social Media · Educațional');
    expect(
      eventGroupLabel(event({ group: logisticaGroup }), readableGroups),
    ).toBe('Logistică');
    expect(
      eventGroupLabel(event({ group: festivalGroup }), readableGroups),
    ).toBe('Festivalul Studențesc 2026');
  });

  it('leaves out a parent that is the Organization Group', () => {
    const underOrganization: EventGroup = { ...eduGroup, path: [5, 7] };
    const withOrganization = new Map<number, Group>([
      [5, group({ id: 5, name: 'OSUBB', path: [5], is_organization: true })],
    ]);
    expect(
      eventGroupLabel(event({ group: underOrganization }), withOrganization),
    ).toBe('Educațional');
  });

  it('reads the Organization label off the marker, not off the Group name', () => {
    const renamed: EventGroup = { ...osubbGroup, name: 'Adunarea Generală' };
    expect(eventGroupLabel(event({ group: renamed }), readableGroups)).toBe(
      'OSUBB',
    );

    const notTheOrganization: EventGroup = {
      ...osubbGroup,
      name: 'OSUBB Cluj',
      category: 'department',
      is_organization: false,
    };
    expect(
      eventGroupLabel(event({ group: notTheOrganization }), readableGroups),
    ).toBe('OSUBB Cluj');
  });

  it('names a Child Group by its parent only when the parent is readable', () => {
    expect(eventGroupLabel(event({ group: socialMediaGroup }))).toBe(
      'Social Media',
    );
  });

  it('falls back to a neutral label when the Event names no readable Group', () => {
    expect(eventGroupLabel(event({ group: null }), readableGroups)).toBe(
      'Grup',
    );
  });

  it('picks the scope icon from the Group category', () => {
    expect(eventGroupIcon(event())).toBe(Globe);
    expect(eventGroupIcon(event({ group: eduGroup }))).toBe(Building2);
    expect(eventGroupIcon(event({ group: socialMediaGroup }))).toBe(Users);
    expect(eventGroupIcon(event({ group: festivalGroup }))).toBe(Rocket);
    expect(eventGroupIcon(event({ group: null }))).toBe(Circle);
  });
});

// Only Departments and the Organization carry a colour: `groups.color` is
// mirrored from `departments.color`, and `teams`/`projects` have no such column,
// so every Team and Project Group is null. Without the ancestor walk a Team
// Event's card turns flat grey — the regression these assertions exist for.
describe('eventAccentColor', () => {
  it('uses the Group own colour when it has one', () => {
    expect(eventAccentColor(event({ group: eduGroup }), readableGroups)).toBe(
      '#284C93',
    );
  });

  // Mutation this catches: delete the `path` walk and read only `group.color`.
  it('walks up to the nearest coloured ancestor for a colourless Group', () => {
    expect(
      eventAccentColor(event({ group: socialMediaGroup }), readableGroups),
    ).toBe('#284C93');
  });

  // The walk is nearest-first, not root-first: a coloured Child Group between
  // the Event's Group and the root wins over the Department at the root.
  it('takes the nearest coloured ancestor, not the root', () => {
    const nested: EventGroup = {
      name: 'Grup Nepot',
      short: null,
      color: null,
      category: 'team',
      path: [7, 30, 31],
      is_organization: false,
    };
    const withMiddle = new Map(readableGroups);
    withMiddle.set(
      30,
      group({
        id: 30,
        name: 'Grup Intermediar',
        color: '#00FF00',
        path: [7, 30],
      }),
    );

    expect(eventAccentColor(event({ group: nested }), withMiddle)).toBe(
      '#00FF00',
    );
  });

  it('falls back to neutral ink for a top-level Group with no colour', () => {
    expect(
      eventAccentColor(event({ group: logisticaGroup }), readableGroups),
    ).toBe('var(--ink-400)');
    expect(eventAccentColor(event({ group: null }), readableGroups)).toBe(
      'var(--ink-400)',
    );
  });

  it('keeps the OSUBB token for an Organization Group with no colour of its own', () => {
    const uncoloured: EventGroup = { ...osubbGroup, color: null };
    expect(eventAccentColor(event({ group: uncoloured }), readableGroups)).toBe(
      'var(--scope-org)',
    );
  });
});

function myGroup(
  id: number,
  path: number[],
  overrides: Partial<MyGroup> = {},
): MyGroup {
  return {
    id,
    path,
    name: `Grup ${id}`,
    short: '',
    color: '',
    category: 'department',
    is_organization: false,
    min_level: 0,
    status: 'active',
    group_role: 'member',
    explicit: true,
    automatic: false,
    ...overrides,
  };
}

// Ruling R10 / ADR-0008 §Relevance: own Groups in colour, the Organization in
// OSUBB red, every other readable Event grey until the member answers "Vin".
describe('the colour rule', () => {
  const socialMedia = event({ id: 20, groupId: 12, group: socialMediaGroup });
  const edu = event({ id: 21, groupId: 7, group: eduGroup });
  const festival = event({ id: 22, groupId: 20, group: festivalGroup });

  it('reads membership, not authority, and walks up the member path', () => {
    const relevant = relevantGroupIds([
      myGroup(12, [7, 12]),
      // A position inherited from an ancestor is authority, not membership.
      myGroup(20, [20], { explicit: false, group_role: 'manager' }),
    ]);
    expect([...relevant].sort((a, b) => a - b)).toEqual([7, 12]);
  });

  it('colours own, organization, other and other-after-Vin Events', () => {
    // A Social Media member: its parent Educațional is theirs too.
    const relevant = relevantGroupIds([myGroup(12, [7, 12])]);
    const none = new Set<number>();

    expect(eventRelevance(event(), relevant, none)).toBe('organization');
    expect(relevanceColor(event(), 'organization')).toBe('var(--scope-org)');

    expect(eventRelevance(socialMedia, relevant, none)).toBe('own');
    expect(eventRelevance(edu, relevant, none)).toBe('own');
    expect(relevanceColor(edu, 'own', readableGroups)).toBe('#284C93');

    expect(eventRelevance(festival, relevant, none)).toBe('other');
    expect(relevanceColor(festival, 'other')).toBe('var(--event-other)');

    const going = new Set([22]);
    expect(eventRelevance(festival, relevant, going)).toBe('going');
    expect(relevanceColor(edu, 'going', readableGroups)).toBe('#284C93');
  });

  it('keeps a Department member grey on its Child Team Events', () => {
    const relevant = relevantGroupIds([myGroup(7, [7])]);
    expect(eventRelevance(socialMedia, relevant, new Set())).toBe('other');
  });
});

describe('the month grid', () => {
  it('builds Monday-first whole weeks with the neighbouring days', () => {
    // 1 October 2026 is a Thursday; 31 October a Saturday.
    const weeks = buildMonthGrid('2026-10', '2026-10-14');
    expect(weeks).toHaveLength(5);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(gridBounds(weeks)).toEqual({
      first: '2026-09-28',
      last: '2026-11-01',
    });
    const days = weeks.flat();
    expect(days.filter((day) => day.inMonth)).toHaveLength(31);
    expect(days.filter((day) => day.isToday).map((d) => d.dayKey)).toEqual([
      '2026-10-14',
    ]);
    expect(days[0]).toMatchObject({ dayNumber: 28, inMonth: false });
  });

  it('keeps every day across the DST changes of October and March', () => {
    // Romania leaves summer time on 25 October 2026 and enters it on 29
    // March 2026 (both Sundays): each day exists once, in the Sunday column.
    const october = buildMonthGrid('2026-10', '').flat();
    expect(october.filter((day) => day.dayKey === '2026-10-25')).toHaveLength(
      1,
    );
    expect(october.findIndex((d) => d.dayKey === '2026-10-25') % 7).toBe(6);
    expect(october.find((d) => d.dayKey === '2026-10-26')).toBeDefined();

    const march = buildMonthGrid('2026-03', '').flat();
    expect(march.filter((day) => day.inMonth)).toHaveLength(31);
    expect(march.findIndex((d) => d.dayKey === '2026-03-29') % 7).toBe(6);
    // March 2026 starts on a Sunday: six weeks, the first padded from February.
    expect(march[0]?.dayKey).toBe('2026-02-23');
    expect(march).toHaveLength(42);
  });

  it('moves between months and names them in Romanian', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-03', -1)).toBe('2026-02');
    expect(monthBounds('2028-02')).toEqual({
      first: '2028-02-01',
      last: '2028-02-29',
    });
    expect(monthLabel('2026-10')).toBe('octombrie 2026');
  });

  it('bounds a read at Bucharest midnights, 23 or 25 hours across DST', () => {
    expect(eventRangeForDays('2026-10-25', '2026-10-25')).toEqual({
      from: '2026-10-24T21:00:00.000Z',
      to: '2026-10-25T22:00:00.000Z',
    });
    expect(eventRangeForDays('2026-03-29', '2026-03-29')).toEqual({
      from: '2026-03-28T22:00:00.000Z',
      to: '2026-03-29T21:00:00.000Z',
    });
    expect(eventRangeForDays()).toEqual({});
  });

  it('counts a day in Romanian for a screen reader', () => {
    expect(countLabel(1, 'eveniment', 'evenimente')).toBe('1 eveniment');
    expect(countLabel(3, 'eveniment', 'evenimente')).toBe('3 evenimente');
    expect(countLabel(21, 'eveniment', 'evenimente')).toBe('21 de evenimente');
    expect(daySummary('2026-10-26', { events: [event()], tasks: [] })).toBe(
      'luni, 26 octombrie 2026: 1 eveniment',
    );
    expect(daySummary('2026-10-26')).toBe('luni, 26 octombrie 2026');
  });
});

function taskRow(overrides: Partial<CalendarTaskRow> = {}): CalendarTaskRow {
  return {
    id: 100,
    title: 'Afiș pentru ședință',
    status: 'in_progress',
    // 00:30 in Bucharest on 26 October, the day after the DST change.
    deadline: '2026-10-25T22:30:00.000Z',
    group_id: 12,
    campaign_id: null,
    group: socialMediaGroup,
    ...overrides,
  };
}

describe('Task chips', () => {
  it('merges own, candidate and managed Tasks, one chip per Task', () => {
    const own = [taskRow()];
    const candidate = [
      taskRow({
        id: 101,
        title: 'Candidatură',
        deadline: '2026-10-20T09:00:00Z',
      }),
      taskRow({ id: 100, title: 'Duplicat' }),
    ];
    const managed = [
      taskRow({
        id: 102,
        title: 'Gestionat',
        deadline: '2026-10-21T09:00:00Z',
      }),
      taskRow({ id: 103, title: 'Fără termen', deadline: null }),
    ];

    const withoutManaged = calendarTasks({ own, candidate }, readableGroups);
    expect(withoutManaged.map((t) => [t.id, t.source])).toEqual([
      [101, 'candidate'],
      [100, 'own'],
    ]);

    const withManaged = calendarTasks(
      { own, candidate, managed },
      readableGroups,
    );
    expect(withManaged.map((t) => [t.id, t.source])).toEqual([
      [101, 'candidate'],
      [102, 'managed'],
      [100, 'own'],
    ]);
    expect(withManaged.find((t) => t.id === 100)).toMatchObject({
      dayKey: '2026-10-26',
      time: '00:30',
      statusLabel: 'În lucru',
      // A Team Task takes its Department's colour, as its Events do.
      color: '#284C93',
      title: 'Afiș pentru ședință',
    });
  });

  it('puts a deadline on its Bucharest day across the March change', () => {
    const [task] = calendarTasks({
      own: [taskRow({ deadline: '2026-03-29T21:30:00.000Z' })],
    });
    // 00:30 summer time, 30 March.
    expect(task?.dayKey).toBe('2026-03-30');
  });

  it('paints an Organization Task OSUBB red', () => {
    const [task] = calendarTasks({
      own: [taskRow({ group_id: 5, group: { ...osubbGroup, color: '#000' } })],
    });
    expect(task?.color).toBe('var(--scope-org)');
  });
});

describe('the Work Filter over the Calendar', () => {
  const events = [
    event({ id: 1, groupId: 12, group: socialMediaGroup, campaignId: 3 }),
    event({ id: 2, groupId: 7, group: eduGroup }),
    event({ id: 3, groupId: 20, group: festivalGroup, dayKey: '2026-09-02' }),
  ];
  const tasks = calendarTasks({
    own: [
      taskRow({ id: 10, campaign_id: 3 }),
      taskRow({ id: 11, group_id: 20, group: festivalGroup }),
    ],
  });

  it('narrows Events by Group path, Campaign and start day', () => {
    expect(filterEvents(events, {}).map((e) => e.id)).toEqual([1, 2, 3]);
    expect(filterEvents(events, { rootGroupId: 7 }).map((e) => e.id)).toEqual([
      1, 2,
    ]);
    expect(
      filterEvents(events, { rootGroupId: 7, groupId: 12 }).map((e) => e.id),
    ).toEqual([1]);
    expect(filterEvents(events, { campaignId: 3 }).map((e) => e.id)).toEqual([
      1,
    ]);
    expect(
      filterEvents(events, { from: '2026-09-01', to: '2026-09-30' }).map(
        (e) => e.id,
      ),
    ).toEqual([3]);
  });

  it('narrows Task chips by Group path, Campaign and deadline day', () => {
    expect(filterTasks(tasks, { rootGroupId: 7 }).map((t) => t.id)).toEqual([
      10,
    ]);
    expect(filterTasks(tasks, { campaignId: 3 }).map((t) => t.id)).toEqual([
      10,
    ]);
    expect(
      filterTasks(tasks, { from: '2026-10-26', to: '2026-10-26' }).map(
        (t) => t.id,
      ),
    ).toEqual([10, 11]);
    expect(filterTasks(tasks, { to: '2026-10-25' })).toEqual([]);
  });

  it('files Events and Tasks under their day', () => {
    const byDay = itemsByDay(events, tasks);
    expect(byDay.get('2026-08-30')?.events.map((e) => e.id)).toEqual([1, 2]);
    expect(byDay.get('2026-10-26')?.tasks.map((t) => t.id)).toEqual([10, 11]);
  });
});

/* ------------------------------------------------------------------------ */
/* #1098 (ruling R63): all-day and several-day Events                        */
/* ------------------------------------------------------------------------ */

/** An Event from `first` to `last`, both Bucharest days, inclusive. */
function spanning(
  id: number,
  first: string,
  last: string,
  overrides: Partial<EventPresentation> = {},
): EventPresentation {
  return event({
    id,
    title: `Eveniment ${id}`,
    dayKey: first,
    lastDayKey: last,
    multiDay: last !== first,
    allDay: true,
    startsAt: `${first}T00:00:00+03:00`,
    endsAt: `${last}T23:59:00+03:00`,
    ...overrides,
  });
}

describe('several-day Events on the month grid', () => {
  // October 2026: Monday 28 September to Sunday 1 November, five rows.
  const weeks = buildMonthGrid('2026-10', '2026-10-14');
  const row = (index: number) => weeks[index] ?? [];

  it('draws one bar over the three days of a weekend', () => {
    const [bar] = layoutWeekBars(row(3), [
      spanning(1, '2026-10-23', '2026-10-25'),
    ]);
    expect(bar).toMatchObject({
      startColumn: 4,
      span: 3,
      lane: 0,
      continuesBefore: false,
      continuesAfter: false,
    });
  });

  it('breaks a bar at the week boundary and goes on in the next row', () => {
    const trip = spanning(2, '2026-10-17', '2026-10-20');
    expect(layoutWeekBars(row(2), [trip])[0]).toMatchObject({
      startColumn: 5,
      span: 2,
      continuesBefore: false,
      continuesAfter: true,
    });
    expect(layoutWeekBars(row(3), [trip])[0]).toMatchObject({
      startColumn: 0,
      span: 2,
      continuesBefore: true,
      continuesAfter: false,
    });
  });

  it('clamps a bar to the visible grid across the month boundary', () => {
    // From 26 September (before the grid's Monday 28) to 2 October.
    const camp = spanning(3, '2026-09-26', '2026-10-02');
    expect(layoutWeekBars(row(0), [camp])[0]).toMatchObject({
      startColumn: 0,
      span: 5,
      continuesBefore: true,
      continuesAfter: false,
    });
    // The last row ends on Sunday 1 November; the Event goes on.
    const festival = spanning(4, '2026-10-30', '2026-11-03');
    expect(layoutWeekBars(row(4), [festival])[0]).toMatchObject({
      startColumn: 4,
      span: 3,
      continuesAfter: true,
    });
  });

  it('stacks overlapping bars in lanes and reuses a lane once it is free', () => {
    const bars = layoutWeekBars(row(2), [
      spanning(5, '2026-10-12', '2026-10-14'),
      spanning(6, '2026-10-13', '2026-10-16'),
      spanning(7, '2026-10-15', '2026-10-17'),
    ]);
    const laneOf = (id: number) =>
      bars.find((bar) => bar.event.id === id)?.lane;
    expect(laneOf(5)).toBe(0);
    expect(laneOf(6)).toBe(1);
    expect(laneOf(7)).toBe(0);
  });

  it('puts the longer of two bars starting the same day in the upper lane', () => {
    const bars = layoutWeekBars(row(2), [
      spanning(8, '2026-10-12', '2026-10-13'),
      spanning(9, '2026-10-12', '2026-10-16'),
    ]);
    expect(bars.find((bar) => bar.event.id === 9)?.lane).toBe(0);
  });

  it('leaves a one-day Event to the chips', () => {
    expect(
      layoutWeekBars(row(2), [spanning(10, '2026-10-14', '2026-10-14')]),
    ).toEqual([]);
  });

  it('keeps every bar level, stops at the chip limit and counts the rest in "+N"', () => {
    const bars = layoutWeekBars(row(2), [
      spanning(11, '2026-10-12', '2026-10-13'),
      spanning(12, '2026-10-13', '2026-10-14'),
    ]);
    // Wednesday 14 October: only the lower bar reaches it, so the upper lane
    // is left empty to keep that bar level with its row.
    const wednesday = dayCellLayout(2, bars, 2, 3);
    expect(wednesday.lanes.map((bar) => bar?.event.id ?? null)).toEqual([
      null,
      12,
    ]);
    expect(wednesday).toMatchObject({ chipsShown: 1, overflow: 1 });
    // Four bars over one Monday: three lanes drawn, the fourth is "+1".
    const crowded = layoutWeekBars(row(2), [
      spanning(13, '2026-10-12', '2026-10-13'),
      spanning(14, '2026-10-12', '2026-10-13'),
      spanning(15, '2026-10-12', '2026-10-13'),
      spanning(16, '2026-10-12', '2026-10-13'),
    ]);
    expect(dayCellLayout(0, crowded, 0, 3)).toMatchObject({
      chipsShown: 0,
      overflow: 1,
    });
    expect(dayCellLayout(0, crowded, 0, 3).lanes).toHaveLength(3);
    // A day without bars keeps today's three chips and "+N".
    expect(dayCellLayout(6, crowded, 5, 3)).toEqual({
      lanes: [],
      chipsShown: 3,
      overflow: 2,
    });
  });

  it('lists a several-day Event on every day it touches, and counts it', () => {
    const byDay = itemsByDay([spanning(17, '2026-10-30', '2026-11-02')], []);
    for (const day of ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
      expect(byDay.get(day)?.events.map((e) => e.id)).toEqual([17]);
    expect(byDay.has('2026-11-03')).toBe(false);
    expect(daySummary('2026-11-01', byDay.get('2026-11-01'))).toBe(
      'duminică, 1 noiembrie 2026: 1 eveniment',
    );
  });

  it('places an Event that runs for centuries only on the visible days', () => {
    const byDay = itemsByDay([spanning(19, '2026-09-20', '2206-01-01')], [], {
      first: '2026-09-28',
      last: '2026-11-08',
    });
    expect(byDay.size).toBe(42);
    expect(byDay.get('2026-09-28')?.events.map((e) => e.id)).toEqual([19]);
    expect(byDay.get('2026-11-08')?.events.map((e) => e.id)).toEqual([19]);
    expect(byDay.has('2026-09-27')).toBe(false);
    expect(byDay.has('2026-11-09')).toBe(false);
  });

  it('keeps a several-day Event in a range any of its days fall in', () => {
    const camp = spanning(18, '2026-09-28', '2026-10-02');
    expect(
      filterEvents([camp], { from: '2026-10-01', to: '2026-10-31' }),
    ).toEqual([camp]);
    expect(filterEvents([camp], { from: '2026-10-03' })).toEqual([]);
    expect(filterEvents([camp], { to: '2026-09-27' })).toEqual([]);
  });
});

describe('the day list of several-day Events', () => {
  it('lists a several-day Event once, under its first day', () => {
    const days = groupEventsByDay([
      spanning(1, '2026-10-24', '2026-10-26'),
      event({ id: 2, dayKey: '2026-10-25', startsAt: '2026-10-25T07:00:00Z' }),
    ]);
    expect(
      days.map((day) => [day.dayKey, day.events.map((e) => e.id)]),
    ).toEqual([
      ['2026-10-24', [1]],
      ['2026-10-25', [2]],
    ]);
  });

  const now = new Date('2026-10-20T10:00:00Z');

  it('says "Toată ziua", and its last day when it has several', () => {
    expect(eventTimeLabel(spanning(1, '2026-10-24', '2026-10-24'), now)).toBe(
      'Toată ziua',
    );
    expect(eventTimeLabel(spanning(2, '2026-10-24', '2026-10-26'), now)).toBe(
      'Toată ziua · până luni, 26 oct.',
    );
    expect(eventTimeLabel(spanning(3, '2026-12-30', '2027-01-02'), now)).toBe(
      'Toată ziua · până sâmbătă, 2 ian. 2027',
    );
  });

  it('gives a timed Event over several days both ends with their days', () => {
    const party = event({
      startsAt: '2026-10-23T15:00:00.000Z',
      endsAt: '2026-10-25T12:00:00.000Z',
      dayKey: '2026-10-23',
      lastDayKey: '2026-10-25',
      multiDay: true,
      startTime: '18:00',
      endTime: '14:00',
    });
    expect(eventTimeLabel(party, now)).toBe(
      'vin., 23 oct., 18:00 → dum., 25 oct., 14:00',
    );
    expect(
      eventTimeLabel(event({ startTime: '18:00', endTime: '20:00' }), now),
    ).toBe('18:00–20:00');
  });

  it('keeps an all-day or several-day Event answerable until it ends', () => {
    // Saturday 24 to Monday 26 October 2026: its end is the 27th's midnight.
    const weekend = spanning(1, '2026-10-24', '2026-10-26', {
      startsAt: '2026-10-23T21:00:00.000Z',
      endsAt: '2026-10-26T22:00:00.000Z',
    });
    expect(eventIsPast(weekend, Date.parse('2026-10-25T09:00:00Z'))).toBe(
      false,
    );
    expect(eventIsPast(weekend, Date.parse('2026-10-26T22:00:00Z'))).toBe(true);
    // A timed one-day Event is past once it has started (ADR-0008).
    const meeting = event({
      startsAt: '2026-10-24T15:00:00.000Z',
      endsAt: '2026-10-24T17:00:00.000Z',
    });
    expect(eventIsPast(meeting, Date.parse('2026-10-24T16:00:00Z'))).toBe(true);
  });
});
