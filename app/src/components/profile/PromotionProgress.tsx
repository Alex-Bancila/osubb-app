import type { ReactNode } from 'react';
import { TrendingUp } from 'lucide-react';
import { ErrorState } from '../states';
import { useAuth } from '../../lib/auth';
import {
  formatDayMonthYear,
  formatPoints,
  parseLocalDate,
} from '../../lib/format';
import { useMyProfile } from '../../queries/profile';
import {
  usePromotionProgress,
  type PromotionProgress as Progress,
} from '../../queries/promotion-progress';
import { useRoles } from '../../queries/reference';

/**
 * #634 — where a Member stands on the automatic ladder (ADR-0004 amended
 * 2026-09-21; rulings R9, R13, R18).
 *
 * Six states, one per rung:
 * - Recrut: the date the `time` rule makes them Voluntar. No bar.
 * - Voluntar before the tenure date: the date they can become Voluntar Activ.
 *   Nothing about points (R18).
 * - Voluntar with tenure: a bar from 0 to the Promotion Threshold in force —
 *   the constant stamped at the previous close, never a live percentile.
 * - Voluntar Activ and Voluntar cu Drept de Vot: their Period points beside the
 *   threshold, the reference the Retention Signal will use. No bar.
 * - Level ≥ 5: nothing at all (R13).
 * - No open Period (or no threshold): the tenure lines only; the bar is hidden,
 *   never faked.
 *
 * Read-only and never a leaderboard: no rank, no other Member's points (R6).
 */
export function PromotionProgress() {
  const { claims } = useAuth();
  const profile = useMyProfile().data;
  const roles = useRoles().data;

  const role = profile?.role ?? claims?.member_role;
  const level =
    claims?.member_level ?? (role ? roles?.get(role)?.level : undefined);
  const onLadder =
    role !== undefined &&
    LADDER_ROLES.has(role) &&
    level !== undefined &&
    level < 5;

  const progress = usePromotionProgress({ enabled: onLadder });

  if (!onLadder || !role) return null;

  if (progress.isError) {
    return (
      <Frame title="Promovare">
        <ErrorState
          text="Nu am putut încărca progresul spre următorul rol."
          error={progress.error}
          onRetry={() => void progress.refetch()}
        />
      </Frame>
    );
  }
  if (!progress.data) return null;

  const view = viewFor(role, profile?.joined_at ?? null, progress.data);
  if (!view) return null;

  switch (view.kind) {
    case 'tenure':
      return (
        <Frame title="Promovare">
          <p className="text-sm font-medium text-foreground">{view.text}</p>
        </Frame>
      );
    case 'bar':
      return (
        <Frame title="Promovare">
          <ThresholdBar points={view.points} threshold={view.threshold} />
        </Frame>
      );
    case 'reference':
      return (
        <Frame title="Punctaj în semestru">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-2xl font-bold text-foreground">
              {formatPoints(view.points)}
            </span>
            <span className="text-sm font-semibold text-muted-foreground">
              {pointWord(view.points)} în {view.periodName}
            </span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Pragul semestrului: {pointCount(view.threshold)}
          </p>
        </Frame>
      );
  }
}

const LADDER_ROLES = new Set(['recrut', 'voluntar', 'activ', 'vot']);

type View =
  | { kind: 'tenure'; text: string }
  | { kind: 'bar'; points: number; threshold: number }
  | { kind: 'reference'; points: number; threshold: number; periodName: string }
  | null;

function viewFor(
  role: string,
  joinedAt: string | null,
  progress: Progress,
): View {
  const { openPeriod, threshold, periodPoints } = progress;
  // The bar needs both an open Period and a target; without either it is hidden.
  const measurable =
    openPeriod !== null && threshold !== null && periodPoints !== null;

  if (role === 'recrut') {
    const date = tenureDate(joinedAt, progress.voluntarTenureMonths);
    return date
      ? { kind: 'tenure', text: `Devii Voluntar din ${formatTenure(date)}` }
      : null;
  }

  if (role === 'voluntar') {
    const date = tenureDate(joinedAt, progress.activTenureMonths);
    if (!date) return null;
    if (measurable && startOfToday() >= date) {
      return { kind: 'bar', points: periodPoints, threshold };
    }
    return {
      kind: 'tenure',
      text: `Poți deveni Voluntar Activ din ${formatTenure(date)}`,
    };
  }

  // Voluntar Activ and Voluntar cu Drept de Vot: no tenure line to fall back on.
  return measurable
    ? {
        kind: 'reference',
        points: periodPoints,
        threshold,
        periodName: openPeriod.name,
      }
    : null;
}

function ThresholdBar({
  points,
  threshold,
}: {
  points: number;
  threshold: number;
}) {
  // Reaching the threshold promotes (R9), so "at" counts as past it.
  const reached = points >= threshold;
  // A stamped threshold can be 0 or negative (net points after reversals and
  // low Ratings): no scale to fill, so the bar is simply full or empty.
  const binary = threshold <= 0;
  const max = binary ? 1 : threshold;
  const shown = binary
    ? Number(reached)
    : Math.min(Math.max(points, 0), threshold);
  const percent = (shown / max) * 100;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-semibold text-foreground">
          {formatPoints(points)} / {pointCount(threshold)}
        </span>
        <span className="text-muted-foreground">în semestrul curent</span>
      </div>
      <div
        role="progressbar"
        aria-label="Progres spre Voluntar Activ"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={shown}
        aria-valuetext={`${formatPoints(points)} din ${pointCount(threshold)}`}
        className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-sm font-medium text-foreground">
        {reached
          ? 'Ai depășit pragul — rolul se acordă automat'
          : `Mai ai ${pointCount(threshold - points)} până la Voluntar Activ`}
      </p>
    </div>
  );
}

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card p-6" data-testid="promotion-progress">
      <div className="card-head">
        <h3 className="card-title flex items-center gap-2">
          <TrendingUp className="size-5 text-primary" aria-hidden="true" />
          <span>{title}</span>
        </h3>
      </div>
      {children}
    </section>
  );
}

/**
 * "1 punct", "5 puncte", "30 de puncte" — Romanian puts "de" before the noun
 * when the last two digits are 00 or 20–99, as `formatTaskCount` does.
 */
function pointWord(points: number): string {
  const count = Math.abs(points);
  if (count === 1) return 'punct';
  const lastTwo = count % 100;
  return count >= 20 && (lastTwo === 0 || lastTwo >= 20)
    ? 'de puncte'
    : 'puncte';
}

function pointCount(points: number): string {
  return `${formatPoints(points)} ${pointWord(points)}`;
}

/**
 * `joined_at` + the rule's months, as a local calendar date. A day the target
 * month lacks clamps to its last day (31 August + 6 months is 28/29 February),
 * the way PostgreSQL's `date + interval 'n months'` does.
 */
function tenureDate(joinedAt: string | null, months: number | null) {
  const joined = parseLocalDate(joinedAt);
  if (!joined || months === null) return null;
  const year = joined.getFullYear();
  const month = joined.getMonth() + months;
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(joined.getDate(), lastDay));
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function formatTenure(date: Date): string {
  const iso = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
  return formatDayMonthYear(iso) ?? iso;
}
