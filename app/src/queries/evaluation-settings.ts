import {
  queryOptions,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { CommandError } from '../lib/command-reasons';
import { formatDayMonthYear, formatDayOrNull } from '../lib/format';
import { supabase } from '../lib/supabase';
import type { WorkFilterValue } from '../lib/work-filter';
import { keys } from './keys';

/**
 * The evaluation settings (R58): one row every Member reads, written only
 * through the three commands below by BC and the Moderator. A value is null
 * until it is first set.
 *
 * - `eligibilityFloor` (Prag minim): the points a Member needs to enter a
 *   Role Evaluation's ranking.
 * - `membershipCutoff` (Data limită de intrare): the day a Voluntar must have
 *   joined by to become a Promotion Candidate.
 * - `pointsStartDate` (Data de început a punctajului): the first Bucharest
 *   day whose Task Points count in any total. The SQL readers apply it; the
 *   app only says it, beside the totals it changes.
 * - `activPercent` and `votPercent` (Procent): the top share each Role
 *   Evaluation kind takes of the eligible Members, x for Voluntar Activ and y
 *   for the Adunarea Generală, 1–100. They live in this row since R58 and are
 *   never null; `set_evaluation_percent` still writes them.
 */
export type EvaluationSettings = {
  eligibilityFloor: number | null;
  membershipCutoff: string | null;
  pointsStartDate: string | null;
  activPercent: number;
  votPercent: number;
  updatedAt: string;
  updatedBy: string | null;
};

export async function fetchEvaluationSettings(): Promise<EvaluationSettings> {
  const { data, error } = await supabase
    .from('evaluation_settings')
    .select(
      'eligibility_floor, membership_cutoff, points_start_date, activ_percent, vot_percent, updated_at, updated_by',
    )
    .eq('id', 1)
    .single();
  if (error) throw error;
  return {
    eligibilityFloor: data.eligibility_floor,
    membershipCutoff: data.membership_cutoff,
    pointsStartDate: data.points_start_date,
    activPercent: data.activ_percent,
    votPercent: data.vot_percent,
    updatedAt: data.updated_at,
    updatedBy: data.updated_by,
  };
}

function settingsQuery(memberId: string | undefined) {
  return queryOptions({
    queryKey: keys.evaluation.settings(memberId),
    queryFn: memberId ? fetchEvaluationSettings : skipToken,
  });
}

export function useEvaluationSettings() {
  return useQuery(settingsQuery(useAuth().session?.user.id));
}

/**
 * The Points Start Date for the surfaces that show a total: `undefined`
 * while the settings load or failed to read (a total then says nothing about
 * a start), `null` once they say no date is set, else the day (`2026-09-01`).
 */
export function usePointsStartDate(): string | null | undefined {
  return useQuery({
    ...settingsQuery(useAuth().session?.user.id),
    select: (settings) => settings.pointsStartDate,
  }).data;
}

/** What a total says about where it begins: `din 01.09.2026`, or nothing. */
export function pointsSinceText(
  date: string | null | undefined,
): string | null {
  const day = formatDayOrNull(date);
  return day ? `din ${day}` : null;
}

/**
 * The period a total counts over, in the words both captions share (the
 * Cup's `puncte acordate …` and Tracker membru's `acordate …`), for the Work
 * Filter's range and the Points Start Date (R58):
 *
 * - an explicit **De la** — even one before the start date, the lookback — is
 *   the range it is: `între 1 august 2026 și 30 septembrie 2026`,
 *   `din 1 august 2026`;
 * - without one the server counts from the start date, so the text begins
 *   there: `din 01.09.2026`, `din 01.09.2026 până la 30 septembrie 2026`;
 * - `null` when nothing narrows the period (the whole record), and
 *   `undefined` while the start date is not known (loading, or a failed
 *   read): a caption must then say nothing about the period rather than
 *   claim the whole record.
 */
export function pointsPeriodText(
  range: Pick<WorkFilterValue, 'from' | 'to'>,
  pointsStartDate: string | null | undefined,
): string | null | undefined {
  const from = range.from && formatDayMonthYear(range.from);
  const to = range.to && formatDayMonthYear(range.to);
  if (from && to) return `între ${from} și ${to}`;
  if (!from && pointsStartDate === undefined) return undefined;
  const begin = from ? `din ${from}` : pointsSinceText(pointsStartDate);
  return [begin, to && `până la ${to}`].filter(Boolean).join(' ') || null;
}

/** What the Setări panel asks the server to do. */
export type EvaluationSettingCommand =
  | { kind: 'floor'; points: number }
  | { kind: 'cutoff'; date: string }
  | { kind: 'pointsStart'; date: string };

const FAILED: Record<EvaluationSettingCommand['kind'], string> = {
  floor: 'Nu am putut salva pragul minim. Reîncearcă.',
  cutoff: 'Nu am putut salva data limită de intrare. Reîncearcă.',
  pointsStart: 'Nu am putut salva data de început a punctajului. Reîncearcă.',
};

export async function runEvaluationSettingCommand(
  command: EvaluationSettingCommand,
): Promise<void> {
  const { error } =
    command.kind === 'floor'
      ? await supabase.rpc('set_eligibility_floor', {
          p_points: command.points,
        })
      : command.kind === 'cutoff'
        ? await supabase.rpc('set_membership_cutoff', {
            p_date: command.date,
          })
        : await supabase.rpc('set_points_start_date', {
            p_date: command.date,
          });
  if (error) throw new CommandError(error, FAILED[command.kind]);
}

/**
 * One mutation for the Setări panel. A setting changes what the evaluation
 * page shows, and the Points Start Date changes every total (the Personal
 * Score, Clasament, the Cup, the Campaign totals), so all three families are
 * read again — after a refusal too, since a stale page is what most refusals
 * report.
 */
export function useEvaluationSettingCommand() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: runEvaluationSettingCommand,
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: keys.evaluation.all }),
        client.invalidateQueries({ queryKey: keys.points.all }),
        client.invalidateQueries({ queryKey: keys.campaigns.all }),
      ]),
  });
}
