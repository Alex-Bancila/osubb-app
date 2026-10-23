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
  campaigns: [
    { id: 3, name: 'Bun venit', group_id: 7 },
    { id: 4, name: 'Toamna AG', group_id: 12 },
  ],
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
  campaignId: null,
  allDay: false,
  allDayTouched: false,
  announce: false,
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
      allDay: false,
      location: 'Sala 305',
      capacity: 30,
      description: 'Stabilim pașii următori.',
      minLevel: 0,
      campaignId: null,
      announce: false,
    });
  });

  // #691: a Campaign owned on the Event Group's path — the server's rule, and
  // its reason, before the round trip.
  it('accepts only a Campaign on the chosen Group path', () => {
    expect(check({ campaignId: 3 })).toEqual([]);
    expect(schema(6).parse({ ...valid, campaignId: 3 }).campaignId).toBe(3);
    expect(check({ campaignId: 4 })).toEqual(['campaignId: invalid_campaign']);
    expect(check({ campaignId: 99 })).toEqual(['campaignId: invalid_campaign']);
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

  it('limits the location to 200 characters, measured trimmed (security pass 2026-09-27)', () => {
    expect(check({ location: '  ' + 'l'.repeat(200) + '  ' })).toEqual([]);
    expect(check({ location: 'l'.repeat(201) })).toEqual([
      'location: location_too_long',
    ]);
  });

  it('limits the description to 2000 characters', () => {
    expect(check({ description: 'd'.repeat(2000) })).toEqual([]);
    expect(check({ description: 'd'.repeat(2001) })).toEqual([
      'description: description_too_long',
    ]);
  });

  // R60: Formatted Text, at most 2000 visible and 4000 stored characters.
  it('measures the description as Formatted Text (R60)', () => {
    // 3600 stored (3599 trimmed), 1199 visible.
    expect(check({ description: '**a** '.repeat(600) })).toEqual([]);
    // 4005 stored, only 801 visible.
    expect(check({ description: '**a**'.repeat(801) })).toEqual([
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
      'campaignId',
    ],
    [
      'title_too_short',
      'title_too_long',
      'description_too_long',
      'location_too_long',
      'starts_at_in_past',
      'invalid_event_title',
      'invalid_event_type',
      'invalid_event_interval',
      'invalid_all_day_bounds',
      'invalid_event_capacity',
      'invalid_event_min_level',
      'event_group_required',
      'event_min_level_below_group',
      'event_min_level_above_actor',
      'invalid_campaign',
    ],
  );
});

// #1098 (ruling R63): Toată ziua. The form shows the last day inclusive; the
// commands store 00:00 Bucharest on the first day and on the day after the
// last — whatever times the values still carry for an untick.
describe('an all-day Event', () => {
  const allDay = (startsAt: string, endsAt: string) => ({
    ...valid,
    allDay: true,
    allDayTouched: true,
    startsAt,
    endsAt,
  });

  it('runs from midnight on the first day to the midnight after the last day', () => {
    expect(
      schema(6).parse(allDay('2026-10-01T18:00', '2026-10-03T20:00')),
    ).toMatchObject({
      allDay: true,
      startsAt: '2026-09-30T21:00:00.000Z',
      endsAt: '2026-10-03T21:00:00.000Z',
    });
  });

  it('is one whole day when the last day is the first', () => {
    expect(
      schema(6).parse(allDay('2026-10-01T18:00', '2026-10-01T20:00')),
    ).toMatchObject({
      startsAt: '2026-09-30T21:00:00.000Z',
      endsAt: '2026-10-01T21:00:00.000Z',
    });
  });

  it('keeps Bucharest midnights across the end of summer time (25 October 2026)', () => {
    // Saturday 24 (EEST, UTC+3) to Sunday 25: it ends at Monday's 00:00 EET.
    expect(
      schema(6).parse(allDay('2026-10-24T09:00', '2026-10-25T17:00')),
    ).toMatchObject({
      startsAt: '2026-10-23T21:00:00.000Z',
      endsAt: '2026-10-25T22:00:00.000Z',
    });
  });

  it('keeps Bucharest midnights across the start of summer time (28 March 2027)', () => {
    // Sunday 28 March 2027 has 23 hours: 00:00 EET to Monday's 00:00 EEST.
    expect(
      schema(6).parse(allDay('2027-03-28T09:00', '2027-03-28T17:00')),
    ).toMatchObject({
      startsAt: '2027-03-27T22:00:00.000Z',
      endsAt: '2027-03-28T21:00:00.000Z',
    });
  });

  it('needs a last day, not before the first', () => {
    expect(check(allDay('2026-10-03T18:00', ''))).toEqual([
      'endsAt: all_day_end_required',
    ]);
    expect(check(allDay('2026-10-03T18:00', '2026-10-02T20:00'))).toEqual([
      'endsAt: all_day_interval',
    ]);
    expect(check(allDay('', ''))).toEqual([
      'startsAt: all_day_start_required',
      'endsAt: all_day_end_required',
    ]);
  });

  it('may start today, already past its midnight, but not yesterday', () => {
    // `now` is 24 September 2026, 13:00 in Bucharest.
    expect(check(allDay('2026-09-24T09:00', '2026-09-24T17:00'))).toEqual([]);
    expect(check(allDay('2026-09-23T09:00', '2026-09-24T17:00'))).toEqual([
      'startsAt: starts_at_in_past',
    ]);
  });
});
