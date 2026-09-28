import type { ReactNode } from 'react';
import { TrendingUp } from 'lucide-react';
import { Panel } from '../layout';
import { ErrorState, Loading } from '../states';
import { formatPoints } from '../../lib/format';
import {
  usePromotionProgressState,
  type PromotionState,
} from './promotion-state';

/**
 * #634 — where a Member stands on the automatic ladder (ADR-0004 amended
 * 2026-09-21; rulings R9, R13, R18).
 *
 * Six states, one per rung:
 * - Recrut: the date the `time` rule makes them Voluntar. No bar.
 * - Voluntar before the tenure date: the date they can become Voluntar Activ.
 *   Nothing about points (R18).
 * - Voluntar with tenure: a bar from 0 to the Voluntar Activ Promotion
 *   Threshold in force (#826), points counted since the last Role Evaluation.
 * - Voluntar Activ and Voluntar cu Drept de Vot: their points beside the
 *   threshold, the reference the Retention Signal will use. No bar.
 * - Level ≥ 5: nothing at all (R13).
 * - No threshold in force: the tenure lines only; the bar is hidden,
 *   never faked.
 *
 * #824 lifts the gate to the page: `usePromotionProgressState` says whether
 * the panel exists at all (`hidden`, in `promotion-state.ts`), and `PromotionPanel` renders one that
 * does — its loading and error states inside the box — so a `PageGrid` cell
 * is never `null`.
 *
 * Read-only and never a leaderboard: no rank, no other Member's points (R6).
 */

/** The panel for a state the page decided to show. */
export function PromotionPanel({
  state,
}: {
  state: Exclude<PromotionState, { kind: 'hidden' }>;
}) {
  const title =
    state.kind === 'view' && state.view.kind === 'reference'
      ? 'Punctaj de la ultima evaluare'
      : 'Promovare';
  return (
    <Panel eyebrow="Parcurs" icon={TrendingUp} title={title}>
      <div data-testid="promotion-progress">
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
  switch (view.kind) {
    case 'tenure':
      return <p className="text-sm font-medium text-foreground">{view.text}</p>;
    case 'bar':
      return (
        <ThresholdBar
          points={view.points}
          threshold={view.threshold}
          sinceLabel={view.sinceLabel}
        />
      );
    case 'reference':
      return (
        <>
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-2xl font-bold text-foreground">
              {formatPoints(view.points)}
            </span>
            <span className="text-sm font-semibold text-muted-foreground">
              {pointWord(view.points)} {view.sinceLabel}
            </span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Pragul în vigoare: {pointCount(view.threshold)}
          </p>
        </>
      );
  }
}

function ThresholdBar({
  points,
  threshold,
  sinceLabel,
}: {
  points: number;
  threshold: number;
  sinceLabel: string;
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
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-semibold text-foreground">
          {formatPoints(points)} / {pointCount(threshold)}
        </span>
        <span className="text-muted-foreground">{sinceLabel}</span>
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
          ? 'Ai depășit pragul — BC va fi anunțat la următoarea evaluare'
          : `Mai ai ${pointCount(threshold - points)} până la Voluntar Activ`}
      </p>
    </div>
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
