import { describe, expect, it } from 'vitest';

import {
  emptyEventFormValues,
  endDayOf,
  minimumLevelChoices,
  withAllDay,
  withEventDates,
  withLastDay,
} from './event-form-model';

// The Event draft's rules are lib/schemas/event.ts's (event.test.ts).
describe('Event form model', () => {
  it('offers only canonical levels between the Group floor and actor ceiling', () => {
    expect(minimumLevelChoices(3, 5).map((choice) => choice.value)).toEqual([
      3, 5,
    ]);
    expect(minimumLevelChoices(0, 9).map((choice) => choice.value)).toEqual([
      0, 1, 2, 3, 5, 6,
    ]);
  });

  it('names each choice by its Role, the whole ladder in order (R29b, R57)', () => {
    expect(minimumLevelChoices(0, 9)).toEqual([
      { value: 0, label: 'Recrut' },
      { value: 1, label: 'Voluntar' },
      { value: 2, label: 'Voluntar Activ' },
      { value: 3, label: 'Voluntar cu Drept de Vot' },
      { value: 5, label: 'BCE' },
      { value: 6, label: 'BC' },
    ]);
    expect(minimumLevelChoices(1, 6).map((choice) => choice.label)).toEqual([
      'Voluntar',
      'Voluntar Activ',
      'Voluntar cu Drept de Vot',
      'BCE',
      'BC',
    ]);
  });
});

// #1098 (ruling R63): Toată ziua ticks itself when the end falls on another
// day, until the author has ticked or unticked it themselves.
describe('Toată ziua', () => {
  const evening = {
    ...emptyEventFormValues,
    startsAt: '2026-10-24T18:00',
    endsAt: '2026-10-24T20:00',
  };

  it('ticks itself when the end moves to another day, keeping the times', () => {
    expect(withEventDates(evening, { endsAt: '2026-10-26T14:00' })).toEqual({
      ...evening,
      endsAt: '2026-10-26T14:00',
      allDay: true,
    });
  });

  it('stays unticked while the end is on the start day, or at the next midnight', () => {
    expect(withEventDates(evening, { endsAt: '2026-10-24T23:00' }).allDay).toBe(
      false,
    );
    // A party until 00:00 is one evening, not two days.
    expect(withEventDates(evening, { endsAt: '2026-10-25T00:00' }).allDay).toBe(
      false,
    );
    expect(endDayOf('2026-10-25T00:00')).toBe('2026-10-24');
    expect(withEventDates(evening, { endsAt: '' }).allDay).toBe(false);
  });

  it('never ticks again once the author has unticked it', () => {
    const ticked = withEventDates(evening, { endsAt: '2026-10-26T14:00' });
    const unticked = withAllDay(ticked, false, '20:00');
    expect(unticked).toMatchObject({
      allDay: false,
      allDayTouched: true,
      startsAt: '2026-10-24T18:00',
      endsAt: '2026-10-26T14:00',
    });
    expect(
      withEventDates(unticked, { endsAt: '2026-10-27T14:00' }).allDay,
    ).toBe(false);
    expect(
      withEventDates(unticked, { startsAt: '2026-10-23T18:00' }).allDay,
    ).toBe(false);
  });

  it('never unticks itself either: a ticked box stays ticked when the end comes back', () => {
    const ticked = withEventDates(evening, { endsAt: '2026-10-26T14:00' });
    expect(withEventDates(ticked, { endsAt: '2026-10-24T20:00' }).allDay).toBe(
      true,
    );
  });

  it('gives a ticked box with no end a one-day Event', () => {
    expect(withAllDay({ ...evening, endsAt: '' }, true, '20:00')).toMatchObject(
      {
        allDay: true,
        allDayTouched: true,
        endsAt: '2026-10-24T20:00',
      },
    );
  });
});

// An end at exactly 00:00 is read one way everywhere: it closes the day
// before, so Friday 20:00 to Sunday 00:00 is Friday and Saturday.
describe('an end at midnight', () => {
  const friday = {
    ...emptyEventFormValues,
    startsAt: '2026-10-23T20:00',
    endsAt: '2026-10-23T22:00',
  };

  it('ticks Toată ziua with Saturday as the last day', () => {
    const ticked = withEventDates(friday, { endsAt: '2026-10-25T00:00' });
    expect(ticked.allDay).toBe(true);
    expect(endDayOf(ticked.endsAt)).toBe('2026-10-24');
  });

  it('keeps the end time for an untick, but never a midnight that would move the day', () => {
    expect(withLastDay('2026-10-24T14:00', '2026-10-26', '20:00')).toBe(
      '2026-10-26T14:00',
    );
    expect(withLastDay('2026-10-25T00:00', '2026-10-26', '20:00')).toBe(
      '2026-10-26T20:00',
    );
  });
});
