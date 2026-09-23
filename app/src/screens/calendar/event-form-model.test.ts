import { describe, expect, it } from 'vitest';

import {
  eventDraft,
  minimumLevelChoices,
  type EventFormOptions,
  type EventFormValues,
} from './event-form-model';

const options: EventFormOptions = {
  groups: [
    {
      id: 1,
      name: 'OSUBB',
      path: [1],
      minLevel: 0,
      isOrganization: true,
    },
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
  groupNames: [
    { id: 1, name: 'OSUBB' },
    { id: 7, name: 'Educațional' },
    { id: 12, name: 'Adunarea Generală' },
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
};

describe('Event form model', () => {
  it('normalizes one valid draft and interprets wall time in Bucharest', () => {
    expect(eventDraft(valid, options, 6)).toEqual({
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

  it.each([
    [{ ...valid, title: '   ' }, 'Scrie titlul evenimentului.'],
    [{ ...valid, groupId: null }, 'Alege grupul evenimentului.'],
    [
      { ...valid, startsAt: '2026-03-29T03:30' },
      'Ora de început nu există în fusul orar al României.',
    ],
    [
      { ...valid, endsAt: '2026-10-01T17:00' },
      'Ora de încheiere trebuie să fie după ora de început.',
    ],
    [
      { ...valid, capacity: '2.5' },
      'Capacitatea trebuie să fie un număr întreg pozitiv.',
    ],
    [
      { ...valid, groupId: 12, minLevel: 0 },
      'Nivelul minim nu poate fi sub nivelul grupului.',
    ],
    [
      { ...valid, minLevel: 6 },
      'Nu poți alege un nivel minim peste nivelul tău.',
    ],
  ] as const)('rejects an invalid local draft', (values, message) => {
    expect(eventDraft(values, options, 5)).toBe(message);
  });

  it('turns blank optional values into null', () => {
    expect(
      eventDraft(
        {
          ...valid,
          endsAt: '',
          location: ' ',
          capacity: '',
          description: '',
        },
        options,
        6,
      ),
    ).toMatchObject({
      endsAt: null,
      location: null,
      capacity: null,
      description: null,
    });
  });

  it('offers only canonical levels between the Group floor and actor ceiling', () => {
    expect(minimumLevelChoices(3, 5).map((choice) => choice.value)).toEqual([
      3, 5,
    ]);
    expect(minimumLevelChoices(0, 9).map((choice) => choice.value)).toEqual([
      0, 3, 5, 6,
    ]);
  });
});
