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
});
