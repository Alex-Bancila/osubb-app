import { describe, expect, it } from 'vitest';
import { decisionsBadgeLabel } from './requests-presentation';

describe('decisionsBadgeLabel (#972)', () => {
  it('counts Requests to decide in Romanian, singular and plural', () => {
    expect(decisionsBadgeLabel(1)).toBe('1 cerere de decis');
    expect(decisionsBadgeLabel(2)).toBe('2 cereri de decis');
    expect(decisionsBadgeLabel(21)).toBe('21 cereri de decis');
  });
});
