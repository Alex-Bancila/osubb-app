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

describe('Chips that fit stay on the line (F-5)', () => {
  it('shows every chip when their widths fit, with no "+n"', () => {
    // The audit's Acasă line: 435 px, the chips 239 px in all.
    expect(chipsThatFit([120, 113], 435)).toBe(2);
  });
  it('lets the last chip truncate rather than fold into "+1"', () => {
    // Acasă at 1280: the Group chip 201 px and the Campaign 233 px overflow
    // a 435 px line by 5 px; the Campaign truncates and stays.
    expect(chipsThatFit([201, 233], 435)).toBe(2);
  });
  it('folds a chip only when too little of it would be left', () => {
    // At 375 the line is 290 px: 201 + 6 + 96 does not fit.
    expect(chipsThatFit([201, 233], 290)).toBe(1);
  });
});
