import { describe, expect, it } from 'vitest';
import { revealedScrollLeft } from './grid-reveal';

// A phone at 375 px, measured in the real grid: the view runs 16–340, the
// pinned checkbox and Nume columns end at 218.
const phone = { viewLeft: 16, viewRight: 340, pinnedRight: 218 };

describe('revealedScrollLeft', () => {
  it('brings an editor wider than the space beside Nume to the right edge, over the pinned columns', () => {
    // Email (216 px) opened at rest: half of it under Nume, past the edge.
    expect(
      revealedScrollLeft({
        ...phone,
        scrollLeft: 66,
        editorLeft: 152,
        editorRight: 368,
      }),
    ).toBe(94);
  });

  it('pulls an editor that fits out from under the pinned columns', () => {
    expect(
      revealedScrollLeft({
        ...phone,
        viewRight: 710,
        pinnedRight: 274,
        scrollLeft: 300,
        editorLeft: 200,
        editorRight: 416,
      }),
    ).toBe(226);
  });

  it('pulls an editor that fits in from the right edge', () => {
    expect(
      revealedScrollLeft({
        ...phone,
        viewRight: 710,
        pinnedRight: 274,
        scrollLeft: 0,
        editorLeft: 600,
        editorRight: 800,
      }),
    ).toBe(90);
  });

  it('leaves an editor already in view where it is', () => {
    expect(
      revealedScrollLeft({
        ...phone,
        viewRight: 1222,
        pinnedRight: 522,
        scrollLeft: 0,
        editorLeft: 522,
        editorRight: 738,
      }),
    ).toBe(0);
  });

  it('keeps the start of an editor wider than the whole grid', () => {
    expect(
      revealedScrollLeft({
        ...phone,
        scrollLeft: 0,
        editorLeft: 250,
        editorRight: 700,
      }),
    ).toBe(234);
  });

  it('never asks for a negative scroll', () => {
    expect(
      revealedScrollLeft({
        ...phone,
        scrollLeft: 10,
        editorLeft: 100,
        editorRight: 200,
      }),
    ).toBe(0);
  });
});
