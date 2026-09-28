import { describe, expect, it } from 'vitest';

import { minimumLevelChoices } from './event-form-model';

// The Event draft's rules are lib/schemas/event.ts's (event.test.ts).
describe('Event form model', () => {
  it('offers only canonical levels between the Group floor and actor ceiling', () => {
    expect(minimumLevelChoices(3, 5).map((choice) => choice.value)).toEqual([
      3, 5,
    ]);
    expect(minimumLevelChoices(0, 9).map((choice) => choice.value)).toEqual([
      0, 3, 5, 6,
    ]);
  });

  it('names each choice by its Role, the events_min_level_ck subset in ladder order (R29b)', () => {
    expect(minimumLevelChoices(0, 9)).toEqual([
      { value: 0, label: 'Recrut' },
      { value: 3, label: 'Voluntar cu Drept de Vot' },
      { value: 5, label: 'BCE' },
      { value: 6, label: 'BC' },
    ]);
    expect(minimumLevelChoices(1, 6).map((choice) => choice.label)).toEqual([
      'Voluntar cu Drept de Vot',
      'BCE',
      'BC',
    ]);
  });
});
