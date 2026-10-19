import { describe, expect, it, vi } from 'vitest';
vi.mock('../../../lib/supabase', () => ({ supabase: {} }));
import {
  countsText,
  defaultRangeStart,
  finalizeConsequences,
  formatInstantDay,
  lineText,
  nextDay,
  promoteHref,
  roleLabel,
  runResultText,
  signalReasonText,
  SIMULATION_NOTE,
  UNIVERSITY_SIGNALS_NOTE,
} from './portofoliu-text';

describe('the confirmation of Finalizează (R58, spec F)', () => {
  const base = {
    from: '2026-07-01',
    to: '2026-09-28',
    floor: 10,
    cutoff: '2026-03-31',
    line: 40,
  };

  it('names the Voluntar Activ consequences, dates as dd.mm.yyyy', () => {
    expect(
      finalizeConsequences({ ...base, kind: 'voluntar_activ', percent: 35 }),
    ).toBe(
      'Clasăm punctele de task primite între 01.07.2026 și 28.09.2026 de toți membrii sub BCE care au cel puțin 10 puncte. Pragul de promovare devine punctele ultimului membru din primii 35%: 40 de puncte. Voluntarii intrați până la 31.03.2026 care îl ating devin candidați la promovare; Voluntarii Activi și Voluntarii cu Drept de Vot sub el, sau sub pragul minim, devin semnale de retenție. Nimeni nu este promovat sau retrogradat automat.',
    );
  });

  it('mirrors it over the voters for the Adunarea Generală, with no cutoff', () => {
    expect(
      finalizeConsequences({
        ...base,
        kind: 'adunarea_generala',
        percent: 25,
        cutoff: null,
        line: 12,
        floor: 1,
      }),
    ).toBe(
      'Clasăm punctele de task primite între 01.07.2026 și 28.09.2026 de toți membrii Adunării Generale care au cel puțin 1 punct. Pragul Adunarea Generală devine punctele ultimului membru din primii 25%: 12 puncte. Voluntarii cu Drept de Vot sub el, sau sub pragul minim, devin semnale de retenție. Nimeni nu este promovat sau retrogradat automat.',
    );
  });

  it.each(['voluntar_activ', 'adunarea_generala'] as const)(
    'says nobody reaches the Prag minim when the %s run has no line',
    (kind) => {
      const text = finalizeConsequences({
        ...base,
        kind,
        percent: 35,
        line: null,
      });
      expect(text).toBe(
        'Nimeni nu atinge pragul minim: evaluarea se înregistrează fără prag nou, iar toți deținătorii devin semnale de retenție.',
      );
    },
  );

  it('never says "vechime" or "semestru"', () => {
    for (const kind of ['voluntar_activ', 'adunarea_generala'] as const) {
      const text = finalizeConsequences({ ...base, kind, percent: 35 });
      expect(text).not.toMatch(/vechime|semestr/i);
    }
  });
});

describe('why a Retention Signal was raised', () => {
  it('compares a Member below the line with the Prag de promovare', () => {
    expect(
      signalReasonText({
        reason: 'below_line',
        taskPoints: 12,
        thresholdUsed: 40,
      }),
    ).toBe('sub pragul de promovare (12 din 40 de puncte)');
  });

  it('compares a Member below the Floor with the Prag minim', () => {
    expect(
      signalReasonText({
        reason: 'below_floor',
        taskPoints: 3,
        thresholdUsed: 10,
      }),
    ).toBe('sub pragul minim (3 din 10 puncte)');
  });

  it('counts with the Romanian plural: 1 punct, de puncte from 20 on', () => {
    const text = (taskPoints: number, thresholdUsed: number) =>
      signalReasonText({ reason: 'below_floor', taskPoints, thresholdUsed });
    expect(text(0, 1)).toBe('sub pragul minim (0 din 1 punct)');
    expect(text(5, 19)).toBe('sub pragul minim (5 din 19 puncte)');
    expect(text(5, 20)).toBe('sub pragul minim (5 din 20 de puncte)');
    expect(text(5, 119)).toBe('sub pragul minim (5 din 119 puncte)');
    expect(text(5, 120)).toBe('sub pragul minim (5 din 120 de puncte)');
  });

  it('says a voter left UBB without any figures', () => {
    expect(
      signalReasonText({
        reason: 'not_ubb_student',
        taskPoints: null,
        thresholdUsed: null,
      }),
    ).toBe('nu mai este student UBB');
  });

  it('keeps the reason alone when a figure is missing', () => {
    expect(
      signalReasonText({
        reason: 'below_floor',
        taskPoints: 3,
        thresholdUsed: null,
      }),
    ).toBe('sub pragul minim');
    expect(
      signalReasonText({
        reason: 'below_line',
        taskPoints: null,
        thresholdUsed: 40,
      }),
    ).toBe('sub pragul de promovare');
  });
});

describe('the line and the counts of a ranking', () => {
  it('names the line by kind, in points', () => {
    expect(lineText('voluntar_activ', 40)).toBe(
      'Prag de promovare: 40 de puncte',
    );
    expect(lineText('adunarea_generala', 1)).toBe(
      'Prag Adunarea Generală: 1 punct',
    );
  });

  it('says nobody reached the Prag minim when there is no line', () => {
    expect(lineText('voluntar_activ', null)).toBe(
      'Nimeni nu atinge pragul minim.',
    );
    expect(lineText('adunarea_generala', null)).toBe(
      'Nimeni nu atinge pragul minim.',
    );
  });

  it('counts the ranked among the evaluated, one as one', () => {
    expect(countsText(4, 6)).toBe('4 clasați din 6 evaluați');
    expect(countsText(0, 3)).toBe('0 clasați din 3 evaluați');
    expect(countsText(1, 1)).toBe('1 clasat din 1 evaluat');
  });

  it('names a Role as the app does, and an unknown one by its id', () => {
    expect(roleLabel('recrut')).toBe('Recrut');
    expect(roleLabel('voluntar')).toBe('Voluntar');
    expect(roleLabel('activ')).toBe('Voluntar Activ');
    expect(roleLabel('vot')).toBe('Voluntar cu Drept de Vot');
    expect(roleLabel('altceva')).toBe('altceva');
  });
});

describe('the notes of the Simulation card', () => {
  it('says nothing was saved, and that Universitate Signals rise on their own', () => {
    expect(SIMULATION_NOTE).toBe('Simulare, nimic nu a fost salvat.');
    expect(UNIVERSITY_SIGNALS_NOTE).toBe(
      'Semnalele „nu mai este student UBB” se ridică automat la schimbarea universității și apar în Semnale de retenție.',
    );
  });
});

describe('Role Evaluation words moved from the old tab', () => {
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
    expect(defaultRangeStart(undefined, '2026-09-28')).toBe('');
  });

  it('finds the calendar day after one, across a month and a year', () => {
    expect(nextDay('2026-06-30')).toBe('2026-07-01');
    expect(nextDay('2026-12-31')).toBe('2027-01-01');
    expect(nextDay('2028-02-28')).toBe('2028-02-29');
  });

  it('writes an instant as its day in Romania, dd.mm.yyyy', () => {
    expect(formatInstantDay('2026-07-01T09:00:00Z')).toBe('01.07.2026');
    // 21:30 UTC is already the next day in Bucharest (EEST, UTC+3).
    expect(formatInstantDay('2026-06-30T21:30:00Z')).toBe('01.07.2026');
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
