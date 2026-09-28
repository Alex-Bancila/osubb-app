import { formatPoints } from '../../lib/format';
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
  const prag = formatPoints(threshold);
  return kind === 'voluntar_activ'
    ? `Clasăm punctele de task primite între ${formatDay(from)} și ${formatDay(to)} de Voluntarii cu vechime și de Voluntarii Activi. Voluntarii cu cel puțin ${prag} puncte devin candidați la promovare; nimeni nu este promovat automat. Voluntarii Activi sub ${prag} puncte devin semnale de retenție. Pragul calculat acum, punctele ultimului Voluntar Activ din primii ${x}%, devine pragul în vigoare pentru următoarea evaluare. BC și Moderatorul primesc câte o notificare pentru fiecare candidat și semnal.`
    : `Clasăm punctele de task primite între ${formatDay(from)} și ${formatDay(to)} de Voluntarii cu Drept de Vot. Cei sub ${prag} puncte devin semnale de retenție; niciun rol nu se retrage automat. Pragul calculat acum, punctele ultimului Voluntar cu Drept de Vot din primii ${y}%, devine pragul în vigoare pentru următoarea evaluare a Adunării Generale.`;
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
