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
  daySummary,
  eventAccentColor,
  eventGroupIcon,
  eventGroupLabel,
  eventRangeForDays,
  eventRelevance,
  eventTypeLabel,
  filterEvents,
  filterTasks,
  gridBounds,
  groupEventsByDay,
  itemsByDay,
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
    dayLabel: 'duminică, 30 august 2026',
    startTime: '10:00',
    endTime: null,
    location: null,
    capacity: null,
    description: null,
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
    legacy_dept_id: 'edu',
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

  // One assertion per Group category, plus the Organization. Mutations this
  // catches: read the parent from the wrong slot of `path` (the Department Team
  // loses its Department and reads bare "Echipă"), and drop the
  // `category === 'project'` branch (the Project shows its own long name where
  // the calendar wants the kind). Dropping the `is_organization` branch is the
  // next test's job — the Organization Group happens to be *named* OSUBB today,
  // so this one would stay green.
  it('labels an Event by its Group, one label per category', () => {
    expect(eventGroupLabel(event(), readableGroups)).toBe('OSUBB');
    expect(eventGroupLabel(event({ group: eduGroup }), readableGroups)).toBe(
      'Educațional',
    );
    expect(
      eventGroupLabel(event({ group: socialMediaGroup }), readableGroups),
    ).toBe('Echipă · Educațional');
    expect(
      eventGroupLabel(event({ group: logisticaGroup }), readableGroups),
    ).toBe('Echipă');
    expect(
      eventGroupLabel(event({ group: festivalGroup }), readableGroups),
    ).toBe('Proiect');
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
    expect(eventGroupLabel(event({ group: socialMediaGroup }))).toBe('Echipă');
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
