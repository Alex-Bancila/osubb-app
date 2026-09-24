import { describe, expect, it } from 'vitest';
import type {
  EventFormOptions,
  EventFormValues,
} from '../../screens/calendar/event-form-model';
import {
  expectMapComplete,
  expectRoutable,
  issues,
} from '../../test/schema-issues';
import { eventSchema, fieldForReason } from './event';

const now = () => new Date('2026-09-24T10:00:00Z');
const options: EventFormOptions = {
  groups: [
    { id: 1, name: 'OSUBB', path: [1], minLevel: 0, isOrganization: true },
    {
      id: 7,
      name: 'Educațional',
      path: [7],
      minLevel: 0,
      isOrganization: false,
    },
    {
      id: 12,
      name: 'Adunarea Generală',
      path: [12],
      minLevel: 3,
      isOrganization: false,
    },
  ],
  groupNames: [],
};
const valid: EventFormValues = {
  title: '  Ședință de planificare  ',
  type: 'sedinta',
  groupId: 7,
  startsAt: '2026-10-01T18:00',
  endsAt: '2026-10-01T20:00',
  location: '  Sala 305  ',
  capacity: '30',
  description: '  Stabilim pașii următori.  ',
  minLevel: 0,
};
const schema = (actorLevel = 5) => eventSchema(options, actorLevel, { now });
const check = (patch: Partial<EventFormValues>, actorLevel = 5) => {
  const result = schema(actorLevel).safeParse({ ...valid, ...patch });
  expectRoutable(result, fieldForReason);
  return issues(result);
};

describe('eventSchema', () => {
  it('normalises one valid draft and reads wall time in Bucharest', () => {
    expect(schema(6).parse(valid)).toEqual({
      title: 'Ședință de planificare',
      type: 'sedinta',
      groupId: 7,
      startsAt: '2026-10-01T15:00:00.000Z',
      endsAt: '2026-10-01T17:00:00.000Z',
      location: 'Sala 305',
      capacity: 30,
      description: 'Stabilim pașii următori.',
      minLevel: 0,
    });
  });

  it('turns blank optional values into null', () => {
    expect(
      schema(6).parse({
        ...valid,
        endsAt: '',
        location: ' ',
        capacity: '',
        description: '',
      }),
    ).toMatchObject({
      endsAt: null,
      location: null,
      capacity: null,
      description: null,
    });
  });

  it.each([
    ['   ', ['title: invalid_event_title']],
    ['ab', ['title: title_too_short']],
    ['abc', []],
    ['t'.repeat(120), []],
    ['t'.repeat(121), ['title: title_too_long']],
  ])('measures the title %j at the boundary', (title, expected) => {
    expect(check({ title })).toEqual(expected);
  });

  it('limits the description to 2000 characters', () => {
    expect(check({ description: 'd'.repeat(2000) })).toEqual([]);
    expect(check({ description: 'd'.repeat(2001) })).toEqual([
      'description: description_too_long',
    ]);
  });

  it.each([
    ['0', ['capacity: invalid_event_capacity']],
    ['1', []],
    ['1000', []],
    ['1001', ['capacity: invalid_event_capacity']],
    ['2.5', ['capacity: invalid_event_capacity']],
  ])('keeps a capacity of %s within 1–1000', (capacity, expected) => {
    expect(check({ capacity })).toEqual(expected);
  });

  it('checks the start, the end and the times that do not exist in Romania', () => {
    expect(check({ startsAt: '' })).toEqual(['startsAt: starts_at_required']);
    expect(check({ startsAt: '2026-03-29T03:30' })).toEqual([
      'startsAt: starts_at_invalid',
    ]);
    expect(check({ startsAt: '2026-09-24T12:00', endsAt: '' })).toEqual([
      'startsAt: starts_at_in_past',
    ]);
    expect(check({ endsAt: '2026-10-01T18:00' })).toEqual([
      'endsAt: invalid_event_interval',
    ]);
    expect(check({ endsAt: '2027-03-28T03:30' })).toEqual([
      'endsAt: ends_at_invalid',
    ]);
    // Editing an Event may keep a start that has passed.
    expect(
      eventSchema(options, 5, { now, creating: false }).safeParse({
        ...valid,
        startsAt: '2026-09-01T12:00',
        endsAt: '',
      }).success,
    ).toBe(true);
  });

  it('keeps the Minimum Level between the Group’s and the actor’s', () => {
    expect(check({ groupId: null })).toEqual(['groupId: event_group_required']);
    expect(check({ type: 'party' as never })).toEqual([
      'type: invalid_event_type',
    ]);
    expect(check({ minLevel: 4 })).toEqual([
      'minLevel: invalid_event_min_level',
    ]);
    expect(check({ groupId: 12, minLevel: 0 })).toEqual([
      'minLevel: event_min_level_below_group',
    ]);
    expect(check({ minLevel: 6 })).toEqual([
      'minLevel: event_min_level_above_actor',
    ]);
    expect(check({ minLevel: 6 }, 9)).toEqual([]);
  });
});

it('maps every reason an Event command raises to an Event field', () => {
  expectMapComplete(
    fieldForReason,
    [
      'title',
      'type',
      'groupId',
      'startsAt',
      'endsAt',
      'location',
      'capacity',
      'description',
      'minLevel',
    ],
    [
      'title_too_short',
      'title_too_long',
      'description_too_long',
      'starts_at_in_past',
      'invalid_event_title',
      'invalid_event_type',
      'invalid_event_interval',
      'invalid_event_capacity',
      'invalid_event_min_level',
      'event_group_required',
      'event_min_level_below_group',
      'event_min_level_above_actor',
    ],
  );
});
