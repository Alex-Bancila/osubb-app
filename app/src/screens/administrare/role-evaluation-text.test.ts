import { describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
import {
  computedThresholdText,
  defaultRangeStart,
  promoteHref,
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

describe('where Promovează leads (#827, #983)', () => {
  const candidate = {
    id: 7,
    memberId: 'ana',
    taskPoints: 48,
    tenureSince: '2026-03-15',
    roleEvaluationId: 1,
    evaluationName: 'Semestrul I',
    thresholdUsed: 30,
    listedAt: '2026-07-01T09:00:00Z',
  };

  it('prefills the Role panel with the run that listed a run candidate', () => {
    const url = new URL(promoteHref(candidate), 'https://app.osubb.ro');
    expect(url.pathname).toBe('/administrare/roluri');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      membru: 'ana',
      rol: 'activ',
      motiv: 'Evaluarea de rol „Semestrul I”',
    });
  });

  it('names the day a live candidate qualified instead', () => {
    const url = new URL(
      promoteHref({
        ...candidate,
        roleEvaluationId: null,
        evaluationName: null,
        listedAt: '2026-10-02T08:30:00Z',
      }),
      'https://app.osubb.ro',
    );
    expect(url.searchParams.get('motiv')).toBe(
      'Candidat la promovare din 02.10.2026',
    );
  });
});
