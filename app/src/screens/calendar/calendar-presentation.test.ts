import {
  businessOutline,
  ellipseOutline,
  globeOutline,
  peopleOutline,
  rocketOutline,
} from 'ionicons/icons';
import { describe, expect, it } from 'vitest';

import type { EventGroup, EventPresentation } from '../../queries/events';
import type { Group } from '../../queries/reference';
import {
  eventAccentColor,
  eventGroupIcon,
  eventGroupLabel,
  eventTypeLabel,
  groupUpcomingEvents,
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
    ...overrides,
  };
}

const readableGroups = new Map<number, Group>([[7, group({})]]);

describe('groupUpcomingEvents', () => {
  it('groups events on the same Bucharest day and sorts them by instant', () => {
    const groups = groupUpcomingEvents([
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
    const groups = groupUpcomingEvents([
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
    expect(groupUpcomingEvents([])).toEqual([]);
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
    expect(eventGroupIcon(event())).toBe(globeOutline);
    expect(eventGroupIcon(event({ group: eduGroup }))).toBe(businessOutline);
    expect(eventGroupIcon(event({ group: socialMediaGroup }))).toBe(
      peopleOutline,
    );
    expect(eventGroupIcon(event({ group: festivalGroup }))).toBe(rocketOutline);
    expect(eventGroupIcon(event({ group: null }))).toBe(ellipseOutline);
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
