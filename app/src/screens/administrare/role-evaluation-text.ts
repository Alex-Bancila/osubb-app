import { formatPointCount, formatPoints } from '../../lib/format';
import type { RoleEvaluationKind } from '../../lib/schemas/role-evaluation';
import type { PromotionCandidate } from '../../queries/role-evaluations';
import {
  ROLE_PANEL_MEMBER_PARAM,
  ROLE_PANEL_REASON_PARAM,
  ROLE_PANEL_ROLE_PARAM,
} from './RolePanel';

/**
 * The words and links of the Evaluări de rol tab (#827) that are worth a test
 * of their own: the days as the Notifications write them, the default start
 * of the next Evaluation Period, the consequences a run's confirmation names
 * and where **Promovează** leads.
 */

/** `2026-02-01` as `01.02.2026`, the calendar day as the Notifications write it. */
export function formatDay(iso: string | null | undefined): string {
  const match = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : '—';
}

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

/** What the confirmation tells BC a run of this kind will do. */
export function runConsequences({
  kind,
  from,
  to,
  threshold,
  x,
  y,
}: {
  kind: RoleEvaluationKind;
  from: string;
  to: string;
  threshold: number;
  /** The Voluntar Activ cohort's top share, percent. */
  x: string;
  /** The Drept de Vot cohort's top share, percent. */
  y: string;
}): string {
  // "30 de puncte", "1 punct" (F-20).
  const prag = formatPointCount(threshold);
  return kind === 'voluntar_activ'
    ? `Clasăm punctele de task primite între ${formatDay(from)} și ${formatDay(to)} de Voluntarii cu vechime și de Voluntarii Activi. Voluntarii cu cel puțin ${prag} devin candidați la promovare; nimeni nu este promovat automat. Voluntarii Activi sub ${prag} devin semnale de retenție. Pragul calculat acum, punctele ultimului Voluntar Activ din primii ${x}%, devine pragul în vigoare pentru următoarea evaluare, dacă este cel puțin 1. BC și Moderatorul primesc câte o notificare pentru fiecare candidat și semnal.`
    : `Clasăm punctele de task primite între ${formatDay(from)} și ${formatDay(to)} de Voluntarii cu Drept de Vot. Cei sub ${prag} devin semnale de retenție; niciun rol nu se retrage automat. Pragul calculat acum, punctele ultimului Voluntar cu Drept de Vot din primii ${y}%, devine pragul în vigoare pentru următoarea evaluare a Adunării Generale, dacă este cel puțin 1.`;
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
 * The computed threshold as the history shows it (Audit D-9). The server
 * hands a computed value over only when it is at least 1; below that the
 * threshold used stays in force, so the value reads as not taken over.
 */
export function computedThresholdText(computed: number | null): string {
  if (computed === null) return '—';
  return computed < 1
    ? `${formatPoints(computed)} · nepreluat (sub 1)`
    : formatPoints(computed);
}

/** Where **Promovează** leads: Roluri on the Member, Voluntar Activ chosen. */
export function promoteHref(candidate: PromotionCandidate): string {
  const params = new URLSearchParams({
    [ROLE_PANEL_MEMBER_PARAM]: candidate.memberId,
    [ROLE_PANEL_ROLE_PARAM]: 'activ',
    [ROLE_PANEL_REASON_PARAM]: `Evaluarea de rol „${candidate.evaluationName}”`,
  });
  return `/administrare/roluri?${params.toString()}`;
}
