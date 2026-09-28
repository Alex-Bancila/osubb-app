import { describe, expect, it } from 'vitest';
import { chipsThatFit } from './task-chips';

describe('One chip line (layout T2)', () => {
  it('shows every chip when they fit', () => {
    expect(chipsThatFit([100, 60, 80], 260)).toBe(3);
  });
  it('keeps room for "+n" when they do not', () => {
    // 100 + 6 + 60 + 6 + 40 ("+n") = 212 fits; adding 80 would not.
    expect(chipsThatFit([100, 60, 80], 230)).toBe(2);
    expect(chipsThatFit([100, 60, 80], 200)).toBe(1);
  });
  it('always keeps the Group chip, which truncates', () => {
    expect(chipsThatFit([400, 60], 200)).toBe(1);
  });
  it('shows everything before layout (no width yet)', () => {
    expect(chipsThatFit([100, 60, 80], 0)).toBe(3);
  });
});
