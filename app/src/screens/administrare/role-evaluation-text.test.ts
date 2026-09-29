import { describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
import {
  computedThresholdText,
  defaultRangeStart,
  runConsequences,
  runResultText,
} from './role-evaluation-text';

/* Audit D-9: the server hands a computed threshold over only when it is at
   least 1; the words must not promise more. */
describe('Role Evaluation words', () => {
  it('labels a computed threshold below 1 as not taken over', () => {
    expect(computedThresholdText(-2)).toBe('−2 · nepreluat (sub 1)');
    expect(computedThresholdText(0)).toBe('0 · nepreluat (sub 1)');
    expect(computedThresholdText(1)).toBe('1');
    expect(computedThresholdText(42)).toBe('42');
    expect(computedThresholdText(null)).toBe('—');
  });

  it('states the "at least 1" condition in both confirmations', () => {
    for (const kind of ['voluntar_activ', 'adunarea_generala'] as const)
      expect(
        runConsequences({
          kind,
          from: '2026-01-01',
          to: '2026-09-28',
          threshold: 10,
          x: '30',
          y: '25',
        }),
      ).toContain('dacă este cel puțin 1.');
  });

  it('counts with the Romanian plural', () => {
    expect(
      runResultText({
        kind: 'voluntar_activ',
        name: 'Toamnă',
        candidates: 1,
        retentionSignals: 1,
      }),
    ).toBe(
      'Evaluarea „Toamnă” a rulat: 1 candidat la promovare, 1 semnal de retenție.',
    );
    expect(
      runResultText({
        kind: 'voluntar_activ',
        name: 'Toamnă',
        candidates: 3,
        retentionSignals: 20,
      }),
    ).toBe(
      'Evaluarea „Toamnă” a rulat: 3 candidați la promovare, 20 de semnale de retenție.',
    );
  });

  it('names no candidates for an Adunarea Generală run', () => {
    expect(
      runResultText({
        kind: 'adunarea_generala',
        name: 'AG',
        candidates: 0,
        retentionSignals: 1,
      }),
    ).toBe('Evaluarea „AG” a rulat: 1 semnal de retenție.');
  });

  it('never prefills a range that starts after today (F-21)', () => {
    expect(defaultRangeStart('2026-06-30', '2026-09-28')).toBe('2026-07-01');
    expect(defaultRangeStart('2026-09-27', '2026-09-28')).toBe('2026-09-28');
    expect(defaultRangeStart('2026-09-28', '2026-09-28')).toBe('');
    expect(defaultRangeStart(null, '2026-09-28')).toBe('');
  });

  it('names a one-point threshold in the singular (F-20)', () => {
    const text = runConsequences({
      kind: 'voluntar_activ',
      from: '2026-01-01',
      to: '2026-09-28',
      threshold: 1,
      x: '30',
      y: '25',
    });
    expect(text).toContain('cel puțin 1 punct devin');
    expect(text).not.toContain('1 puncte');
  });
});
