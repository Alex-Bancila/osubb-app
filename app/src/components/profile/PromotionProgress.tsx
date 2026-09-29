import type { ReactNode } from 'react';
import { TrendingUp } from 'lucide-react';
import { Panel } from '../layout';
import { ErrorState, Loading } from '../states';
import { formatPointCount, formatPoints, pointWord } from '../../lib/format';
import {
  usePromotionProgressState,
  type PromotionState,
  type View,
} from './promotion-state';

/**
 * #634, #828 — where a Member stands before the next Role Evaluation
 * (ADR-0004 amended 2026-09-21; rulings R9, R13, R18, R28).
 *
 * Only the Recrut → Voluntar step is a date the tenure job keeps. Every other
 * step is BC's decision at a Role Evaluation: reaching the Promotion
 * Threshold makes a tenured Voluntar a Promotion Candidate at the next Voluntar
 * Activ Role Evaluation, and nothing here promises a Role.
 *
 * Six states, one per rung:
 * - Recrut: the date the `time` rule makes them Voluntar; once that date has
 *   passed, that the next run applies it (#859 B43). No bar.
 * - Voluntar before the tenure date: the date they can become Voluntar Activ.
 *   Nothing about the threshold (R18).
 * - Voluntar with tenure: a bar from 0 to the Voluntar Activ Promotion
 *   Threshold in force, points counted since the last Voluntar Activ Role
 *   Evaluation (the total before any); past it, BC is told at the next one.
 * - Voluntar Activ: their points beside the Voluntar Activ threshold; a
 *   Voluntar cu Drept de Vot: beside the Adunarea Generală threshold — the
 *   reference the Retention Signal uses. No bar.
 * - Level ≥ 5: nothing at all (R13).
 * - No threshold in force for the kind: the tenure lines only; the bar and
 *   the reference are hidden, never faked.
 *
 * #859 (B38): Profil's one points panel. Given the Member's total, the panel
 * leads with it, once: before any Role Evaluation the bar's or the
 * reference's figure *is* the total, so it is not printed twice; after one,
 * the figure below reads "din <day> (după ultima evaluare)", never "în
 * total"; while that day is still ahead, the panel says when the count
 * starts instead of a 0 (F-6, #893).
 *
 * #824 lifts the gate to the page: `usePromotionProgressState` says whether
 * the panel exists at all (`hidden`, in `promotion-state.ts`), and
 * `PromotionPanel` renders one that does — its loading and error states
 * inside the box — so a `PageGrid` cell is never `null`.
 *
 * Read-only and never a leaderboard: no rank, no other Member's points (R6).
 */

/** The panel for a state the page decided to show. */
export function PromotionPanel({
  state,
  totalPoints,
}: {
  state: Exclude<PromotionState, { kind: 'hidden' }>;
  /** The Member's total (`my_points`); the panel then leads with it. */
  totalPoints?: number;
}) {
  const view = state.kind === 'view' ? state.view : null;
  // A Voluntar Activ or a Voluntar cu Drept de Vot has no promotion to show
  // here, only their points against the reference threshold.
  const title = view?.kind === 'reference' ? 'Punctaj' : 'Punctaj și promovare';
  // Before any Role Evaluation the figure below is the total already.
  const figureIsTotal = view !== null && view.kind !== 'tenure' && !view.since;
  const showTotal = totalPoints !== undefined && !figureIsTotal;
  return (
    <Panel eyebrow="Parcurs" icon={TrendingUp} title={title}>
      <div data-testid="promotion-progress" className="flex flex-col gap-3">
        {showTotal && <PointsTotal points={totalPoints} />}
        <PromotionBody state={state} />
      </div>
    </Panel>
  );
}

/** Standalone: the panel, or nothing when there is nothing to show. */
export function PromotionProgress() {
  const state = usePromotionProgressState();
  return state.kind === 'hidden' ? null : <PromotionPanel state={state} />;
}

/** The Member's total, the page's one "points" figure. */
export function PointsTotal({ points }: { points: number }) {
  return (
    <p
      className="m-0 flex flex-wrap items-baseline gap-2 leading-none"
      data-testid="points-total"
    >
      <span className="text-[length:var(--fs-2xl)] font-extrabold tracking-[-0.02em] text-foreground tabular-nums">
        {formatPoints(points)}
      </span>
      <span className="text-base font-semibold text-muted-foreground">
        {pointWord(points)}
      </span>
    </p>
  );
}

function PromotionBody({
  state,
}: {
  state: Exclude<PromotionState, { kind: 'hidden' }>;
}): ReactNode {
  if (state.kind === 'loading') {
    return <Loading label="Se încarcă progresul…" />;
  }
  if (state.kind === 'error') {
    return (
      <ErrorState
        text="Nu am putut încărca progresul spre următorul rol."
        error={state.error}
        onRetry={state.retry}
      />
    );
  }
  const { view } = state;
  if (view.kind !== 'tenure' && view.startsLater && view.since) {
    return <CountStartsLater since={view.since} threshold={view.threshold} />;
  }
  switch (view.kind) {
    case 'tenure':
      return (
        <p className="m-0 text-sm font-medium text-foreground">{view.text}</p>
      );
    case 'bar':
      return (
        <ThresholdBar
          points={view.points}
          threshold={view.threshold}
          since={view.since}
        />
      );
    case 'reference':
      return <Reference view={view} />;
  }
}

/**
 * "din 1 iulie 2026 (după ultima evaluare)" — the figure's period. `since` is
 * the day after the last range, so it is named as the day the count starts,
 * never as the evaluation's date (F-6, #893).
 */
function sinceText(since: string): string {
  return `din ${since} (după ultima evaluare)`;
}

/**
 * A Role Evaluation whose range ended today: the count starts tomorrow, so
 * there is no figure yet — a "0 / 30" would read as points lost (F-6).
 */
function CountStartsLater({
  since,
  threshold,
}: {
  since: string;
  threshold: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-sm font-medium text-foreground">
        Punctele pentru următoarea evaluare se numără din {since}.
      </p>
      <p className="m-0 text-sm text-muted-foreground">
        Pragul în vigoare: {formatPointCount(threshold)}
      </p>
    </div>
  );
}

function Reference({
  view,
}: {
  view: Extract<NonNullable<View>, { kind: 'reference' }>;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 flex flex-wrap items-baseline gap-2">
        <span
          className={
            view.since
              ? 'text-lg font-bold text-foreground tabular-nums'
              : 'text-[length:var(--fs-2xl)] leading-none font-extrabold tracking-[-0.02em] text-foreground tabular-nums'
          }
        >
          {formatPoints(view.points)}
        </span>
        <span className="text-sm font-semibold text-muted-foreground">
          {pointWord(view.points)}
          {view.since && ` ${sinceText(view.since)}`}
        </span>
      </p>
      <p className="m-0 text-sm text-muted-foreground">
        Pragul în vigoare: {formatPointCount(view.threshold)}
      </p>
    </div>
  );
}

function ThresholdBar({
  points,
  threshold,
  since,
}: {
  points: number;
  threshold: number;
  since: string | null;
}) {
  // Reaching the threshold makes a Promotion Candidate at the next Role
  // Evaluation (#826); BC decides. "At" counts as past it.
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
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
        <span className="font-semibold text-foreground">
          {formatPoints(points)} / {formatPointCount(threshold)}
        </span>
        {since && (
          <span className="text-muted-foreground">{sinceText(since)}</span>
        )}
      </div>
      <div
        role="progressbar"
        aria-label="Progres spre pragul Voluntar Activ"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={shown}
        aria-valuetext={`${formatPoints(points)} din ${formatPointCount(threshold)}`}
        className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="m-0 text-sm font-medium text-foreground">
        {reached
          ? 'Ai depășit pragul — BC va fi anunțat la următoarea evaluare'
          : `Mai ai ${formatPointCount(threshold - points)} până la pragul Voluntar Activ`}
      </p>
    </div>
  );
}
