import { describe, expect, it } from 'vitest';

import type { EventPresentation } from '../../queries/events';
import type { Department } from '../../queries/reference';
import {
  eventScopeLabel,
  eventTypeLabel,
  groupUpcomingEvents,
} from './calendar-presentation';

function event(overrides: Partial<EventPresentation> = {}): EventPresentation {
  return {
    id: 1,
    title: 'Ședință generală',
    type: 'sedinta',
    scope: 'org',
    departmentId: null,
    teamId: null,
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

const departments = new Map<string, Department>([
  [
    'edu',
    {
      id: 'edu',
      name: 'Educațional',
      short: 'EDU',
      color: '#284C93',
      kind: 'department',
    },
  ],
]);

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

  it('labels organization, department, and team scope without exposing IDs', () => {
    expect(eventScopeLabel(event(), departments)).toBe('OSUBB');
    expect(
      eventScopeLabel(
        event({ scope: 'dept', departmentId: 'edu' }),
        departments,
      ),
    ).toBe('Educațional');
    expect(
      eventScopeLabel(
        event({ scope: 'team', departmentId: 'edu', teamId: 'social-media' }),
        departments,
      ),
    ).toBe('Echipă · Educațional');
  });

  it('uses neutral metadata placeholders while department data is unavailable', () => {
    expect(eventScopeLabel(event({ scope: 'dept', departmentId: 'edu' }))).toBe(
      'Departament',
    );
    expect(
      eventScopeLabel(
        event({ scope: 'team', departmentId: 'edu', teamId: 'social-media' }),
      ),
    ).toBe('Echipă');
  });
});
