import { bucharestDayKey } from '../../../lib/calendar-time';
import { formatDay, formatPointCount, formatPoints } from '../../../lib/format';
import type { MemberIdentity } from '../../../components/member/member-identity';
import type { RoleEvaluationKind } from '../../../lib/schemas/role-evaluation';
import type {
  PromotionCandidate,
  RetentionSignal,
  RoleEvaluation,
} from '../../../queries/role-evaluations';
import {
  ROLE_PANEL_MEMBER_PARAM,
  ROLE_PANEL_REASON_PARAM,
  ROLE_PANEL_ROLE_PARAM,
} from '../RolePanel';

/**
 * The words and links of Portofoliu Interne (R58) that are worth a test of
 * their own: the days as the Notifications write them, the default start of
 * the next Evaluation Period, the consequences a finalised run's confirmation
 * names, why a Retention Signal was raised, and where **Promovează** leads.
 */

/** The kind as the page names it. */
export const KIND_LABEL: Record<string, string> = {
  voluntar_activ: 'Voluntar Activ',
  adunarea_generala: 'Adunarea Generală',
};

const ROLE_LABEL: Record<string, string> = {
  recrut: 'Recrut',
  voluntar: 'Voluntar',
  activ: 'Voluntar Activ',
  vot: 'Voluntar cu Drept de Vot',
};

/** The name a Promotion Threshold goes by, one per kind (the copy never says "prag" alone). */
export const THRESHOLD_LABEL: Record<RoleEvaluationKind, string> = {
  voluntar_activ: 'Prag de promovare',
  adunarea_generala: 'Prag Adunarea Generală',
};

/** The name of each kind's Procent. */
export const PERCENT_LABEL: Record<RoleEvaluationKind, string> = {
  voluntar_activ: 'Procent Voluntar Activ',
  adunarea_generala: 'Procent Adunarea Generală',
};

/** The range of a run, as `01.02.2026–30.06.2026`. */
export function rangeText(
  run: Pick<RoleEvaluation, 'period_from' | 'period_to'>,
) {
  return `${formatDay(run.period_from)}–${formatDay(run.period_to)}`;
}

/** A points figure, or `—` for a line a run had none to show (R58). */
export function pointsOrDash(points: number | null): string {
  return points === null ? '—' : formatPoints(points);
}

/** The name an action's accessible label repeats. */
export function shownName(
  memberId: string,
  identities: Map<string, MemberIdentity> | undefined,
) {
  const identity = identities?.get(memberId);
  return identity?.nickname?.trim() || identity?.fullName || 'Membru OSUBB';
}

/** The name of a run for a log row or a note, `…` until the runs are read. */
export function runNameOf(
  evaluations: readonly RoleEvaluation[],
  id: number | null,
) {
  return evaluations.find((run) => run.id === id)?.name ?? '…';
}

/** Refusals after which a Candidate's row is gone: the panel reports them. */
export const STALE_CANDIDATE = new Set([
  'promotion_candidate_not_found',
  'promotion_candidate_decided',
]);

/** A Role as the app names it; an unknown id stands for itself. */
export function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role;
}

/** The note over a Simulation's result: nothing was written. */
export const SIMULATION_NOTE = 'Simulare, nimic nu a fost salvat.';

/**
 * Under the Signals of a Simulation: the ones about Universitate are not a
 * result of any run, so the rows cannot show them.
 */
export const UNIVERSITY_SIGNALS_NOTE =
  'Semnalele „nu mai este student UBB” se ridică automat la schimbarea universității și apar în Semnale de retenție.';

/** The calendar day after `iso` (`2026-06-30` → `2026-07-01`). */
export function nextDay(iso: string): string {
  const [year = 0, month = 1, day = 1] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1))
    .toISOString()
    .slice(0, 10);
}

/**
 * The "De la" a new run starts from: the day after the last range, unless
 * that is after today (F-21) — a run that ended today leaves nothing to
 * prefill, so the field stays empty rather than inverted.
 */
export function defaultRangeStart(
  lastTo: string | null | undefined,
  today: string,
): string {
  if (!lastTo) return '';
  const start = nextDay(lastTo);
  return start <= today ? start : '';
}

/** An instant's day in Romania, as `01.02.2026`. */
export function formatInstantDay(instant: string): string {
  return formatDay(bucharestDayKey(instant));
}

/**
 * What the confirmation of **Finalizează** tells BC a run will do (spec F):
 * who is ranked, over which days and from which Prag minim, the line the run
 * hands over, and who becomes a Candidate or a Signal. Nothing is ever
 * promoted or demoted by it. With no line — nobody reached the Prag minim —
 * the run is recorded without a new line and every holder is a Signal.
 */
export function finalizeConsequences({
  kind,
  from,
  to,
  floor,
  percent,
  cutoff,
  line,
}: {
  kind: RoleEvaluationKind;
  from: string;
  to: string;
  floor: number;
  percent: number;
  cutoff: string | null;
  line: number | null;
}): string {
  if (line === null)
    return `Nimeni nu atinge pragul minim: evaluarea se înregistrează fără un nou ${THRESHOLD_LABEL[kind]}, iar toți deținătorii devin semnale de retenție.`;
  const ranked = `Clasăm punctele de task primite între ${formatDay(from)} și ${formatDay(to)} de toți membrii ${kind === 'voluntar_activ' ? 'sub BCE' : 'Adunării Generale'} care au cel puțin ${formatPointCount(floor)}.`;
  const handed = `${kind === 'voluntar_activ' ? 'Pragul de promovare' : 'Pragul Adunarea Generală'} devine punctele ultimului membru din primii ${percent} %: ${formatPointCount(line)}.`;
  const outcome =
    kind === 'voluntar_activ'
      ? `Voluntarii intrați până la ${formatDay(cutoff)} care îl ating devin candidați la promovare; Voluntarii Activi și Voluntarii cu Drept de Vot sub el, sau sub pragul minim, devin semnale de retenție.`
      : 'Voluntarii cu Drept de Vot sub el, sau sub pragul minim, devin semnale de retenție.';
  return `${ranked} ${handed} ${outcome} Nimeni nu este promovat sau retrogradat automat.`;
}

/**
 * A count with its Romanian noun: one, a few, or "de" from 20 (the rule of
 * `formatTaskCount`).
 */
function counted(count: number, one: string, many: string): string {
  if (count === 1) return `1 ${one}`;
  const lastTwo = count % 100;
  const de = count >= 20 && (lastTwo === 0 || lastTwo >= 20);
  return `${count} ${de ? 'de ' : ''}${many}`;
}

/**
 * What a finished run found (Audit D-9): the plural is right, and an
 * Adunarea Generală run — which has no promotion path — names no candidates.
 */
export function runResultText({
  kind,
  name,
  candidates,
  retentionSignals,
}: {
  kind: RoleEvaluationKind;
  name: string;
  candidates: number;
  retentionSignals: number;
}): string {
  const signals = counted(
    retentionSignals,
    'semnal de retenție',
    'semnale de retenție',
  );
  return kind === 'voluntar_activ'
    ? `Evaluarea „${name}” a rulat: ${counted(candidates, 'candidat la promovare', 'candidați la promovare')}, ${signals}.`
    : `Evaluarea „${name}” a rulat: ${signals}.`;
}

/**
 * Why a Retention Signal was raised, in the words of its figures:
 * `sub pragul de promovare (12 din 40 de puncte)` for a Member ranked below the
 * Voluntar Activ line, `sub pragul Adunării Generale (12 din 40 de puncte)` for
 * a voter below the Adunarea Generală's (it has no promotion, and the
 * Notification words it so), `sub pragul minim (3 din 10 puncte)` for one
 * under the Prag minim, and `nu mai este student UBB` for a voter whose
 * Universitate is not UBB.
 * `thresholdUsed` is the figure the points are compared with: the line for the
 * first, the Prag minim for the second (a stored Signal of a Member under the
 * Floor carries the run's line, so the caller hands over the run's Floor). The
 * reason stands alone when a figure is missing.
 */
export function signalReasonText(
  signal: Pick<
    RetentionSignal,
    'kind' | 'reason' | 'taskPoints' | 'thresholdUsed'
  >,
): string {
  if (signal.reason === 'not_ubb_student') return 'nu mai este student UBB';
  const reason =
    signal.reason === 'below_floor'
      ? 'sub pragul minim'
      : signal.kind === 'adunarea_generala'
        ? 'sub pragul Adunării Generale'
        : 'sub pragul de promovare';
  if (signal.taskPoints === null || signal.thresholdUsed === null)
    return reason;
  return `${reason} (${formatPoints(signal.taskPoints)} din ${formatPointCount(signal.thresholdUsed)})`;
}

/**
 * The line a ranking found, named by its kind — or that nobody reached the
 * Prag minim, so there is none.
 */
export function lineText(
  kind: RoleEvaluationKind,
  line: number | null,
): string {
  if (line === null) return 'Nimeni nu atinge pragul minim.';
  return `${THRESHOLD_LABEL[kind]}: ${formatPointCount(line)}`;
}

/** How many Members were ranked among those evaluated (one as one). */
export function countsText(ranked: number, evaluated: number): string {
  return `${ranked} ${ranked === 1 ? 'clasat' : 'clasați'} din ${evaluated} ${evaluated === 1 ? 'evaluat' : 'evaluați'}`;
}

/**
 * Where **Promovează** leads: Roluri on the Member, Voluntar Activ chosen, the
 * reason prefilled with the run that listed them or, for a candidate listed
 * between runs (#983), the day they qualified.
 */
export function promoteHref(candidate: PromotionCandidate): string {
  const params = new URLSearchParams({
    [ROLE_PANEL_MEMBER_PARAM]: candidate.memberId,
    [ROLE_PANEL_ROLE_PARAM]: 'activ',
    [ROLE_PANEL_REASON_PARAM]:
      candidate.evaluationName === null
        ? `Candidat la promovare din ${formatInstantDay(candidate.listedAt)}`
        : `Evaluarea de rol „${candidate.evaluationName}”`,
  });
  return `/administrare/roluri?${params.toString()}`;
}
