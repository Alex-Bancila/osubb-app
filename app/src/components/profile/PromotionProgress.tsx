import type { ReactNode } from 'react';
import { Panel } from '../layout';
import { ErrorState, Loading } from '../states';
import { formatPointCount, formatPoints, pointWord } from '../../lib/format';
import { pointsSinceText } from '../../lib/points-period';
import { usePointsStartDate } from '../../queries/evaluation-settings';
import {
  usePromotionProgressState,
  type PromotionState,
  type View,
} from './promotion-state';

/**
 * #634, #828 — where a Member stands before the next Role Evaluation
 * (ADR-0004 amended 2026-09-21; rulings R9, R13, R18, R28).
 *
 * Every step is BC's decision (R58 dropped the promotion by the calendar):
 * reaching the Promotion Threshold makes a Voluntar who joined by the
 * Membership Cutoff Date a Promotion Candidate at once (#983) and at every
 * Voluntar Activ Role Evaluation, and nothing here promises a Role.
 *
 * States, one per rung:
 * - Recrut: nothing; BC promotes by hand in Roluri, so there is no date to
 *   show.
 * - Voluntar who joined after the Membership Cutoff Date: the day they must
 *   have joined by. Nothing about the threshold (R18). With no cutoff set,
 *   nothing at all.
 * - Voluntar who joined by the cutoff: a bar from 0 to the Voluntar Activ
 *   Promotion Threshold in force, points counted since the last Voluntar
 *   Activ Role Evaluation (the total before any); past it, they are a
 *   candidate and BC has been told (#983).
 * - Voluntar Activ: their points beside the Voluntar Activ threshold; a
 *   Voluntar cu Drept de Vot: beside the Adunarea Generală threshold — the
 *   reference the Retention Signal uses. No bar.
 * - Level ≥ 5: nothing at all (R13).
 * - No threshold in force for the kind: the cutoff line only; the bar and
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
 * R58: once BC has set a Points Start Date, the total says from when it counts
 * (`din 01.09.2026`) under the number. The figure below is the Member's
 * standing (`my_role_evaluation_standing`), which starts at the later of the
 * day after the last Role Evaluation and that date (ruling 17), so with a date
 * set — or not yet known — it is never taken for the total: the panel leads
 * with the floored total and the bar or the reference keeps a figure of its
 * own, with the day it counts from. That day is "(după ultima evaluare)" only
 * when a run opened the window: when the start date did, or while it is not
 * known which, the day stands alone.
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
  const startDate = usePointsStartDate();
  // Before any Role Evaluation the figure below is the total already — but
  // only where no Points Start Date floors the total, and only a confirmed
  // `null` says so. While the date is unknown (`undefined`: loading, or a
  // failed read) the floored total leads instead, so the figure is always
  // correct and the layout does not jump once the settings arrive.
  const figureIsTotal =
    view !== null &&
    view.kind !== 'cutoff' &&
    !view.since &&
    startDate === null;
  const showTotal = totalPoints !== undefined && !figureIsTotal;
  return (
    <Panel title={title}>
      <div data-testid="promotion-progress" className="flex flex-col gap-3">
        {showTotal && <PointsTotal points={totalPoints} />}
        <PromotionBody state={state} startDate={startDate} leads={!showTotal} />
      </div>
    </Panel>
  );
}

/** Standalone: the panel, or nothing when there is nothing to show. */
export function PromotionProgress() {
  const state = usePromotionProgressState();
  return state.kind === 'hidden' ? null : <PromotionPanel state={state} />;
}

/**
 * The Member's total, the page's one "points" figure — and, once BC has set a
 * Points Start Date (R58), from when it counts, on a line under the number.
 */
export function PointsTotal({ points }: { points: number }) {
  const since = pointsSinceText(usePointsStartDate());
  return (
    <div className="flex flex-col gap-1.5">
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
      {since && (
        <p
          className="m-0 text-sm text-muted-foreground"
          data-testid="points-since"
        >
          {since}
        </p>
      )}
    </div>
  );
}

function PromotionBody({
  state,
  startDate,
  leads,
}: {
  state: Exclude<PromotionState, { kind: 'hidden' }>;
  /** The Points Start Date: `undefined` while it is not known. */
  startDate: string | null | undefined;
  /** No total leads the panel, so the Member's figure may. */
  leads: boolean;
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
  if (view.kind !== 'cutoff' && view.startsLater && view.since) {
    return <CountStartsLater since={view.since} threshold={view.threshold} />;
  }
  switch (view.kind) {
    case 'cutoff':
      return (
        <p className="m-0 text-sm font-medium text-foreground">{view.text}</p>
      );
    case 'bar':
      return (
        <ThresholdBar
          points={view.points}
          threshold={view.threshold}
          since={view.since}
          afterRun={openedByRun(view.sinceIso, startDate)}
        />
      );
    case 'reference':
      return (
        <Reference
          view={view}
          afterRun={openedByRun(view.sinceIso, startDate)}
          leads={leads && !view.since}
        />
      );
  }
}

/**
 * Whether a Role Evaluation opened the window the figure counts over (ruling
 * 17): `since` is the later of the day after the last run and the Points
 * Start Date, so it is the run's only when it is after the start date. It is
 * the start date's when the two coincide, and nothing is claimed while the
 * date is not known (`undefined`).
 */
function openedByRun(
  sinceIso: string | null,
  startDate: string | null | undefined,
): boolean {
  return (
    sinceIso !== null &&
    startDate !== undefined &&
    (startDate === null || sinceIso > startDate)
  );
}

/**
 * "din 01.07.2026 (după ultima evaluare)" — the figure's period. `since` is
 * the day after the last range, so it is named as the day the count starts,
 * never as the evaluation's date (F-6, #893). When the Points Start Date
 * opened the window instead, the day stands alone: "din 01.10.2026".
 */
function sinceText(since: string, afterRun: boolean): string {
  return afterRun ? `din ${since} (după ultima evaluare)` : `din ${since}`;
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
      <p
        className="m-0 text-sm font-medium text-foreground"
        data-testid="count-starts"
      >
        Punctele pentru următoarea evaluare se numără din{' '}
        <span className="whitespace-nowrap">{since}</span>.
      </p>
      <p className="m-0 text-sm text-muted-foreground">
        Pragul în vigoare: {formatPointCount(threshold)}
      </p>
    </div>
  );
}

function Reference({
  view,
  afterRun,
  leads,
}: {
  view: Extract<NonNullable<View>, { kind: 'reference' }>;
  afterRun: boolean;
  /** The figure is the panel's one big number: no total above it. */
  leads: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 flex flex-wrap items-baseline gap-2">
        <span
          className={
            leads
              ? 'text-[length:var(--fs-2xl)] leading-none font-extrabold tracking-[-0.02em] text-foreground tabular-nums'
              : 'text-lg font-bold text-foreground tabular-nums'
          }
        >
          {formatPoints(view.points)}
        </span>
        <span className="text-sm font-semibold text-muted-foreground">
          {pointWord(view.points)}
          {view.since && ` ${sinceText(view.since, afterRun)}`}
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
  afterRun,
}: {
  points: number;
  threshold: number;
  since: string | null;
  afterRun: boolean;
}) {
  // Reaching the threshold makes a Promotion Candidate at once (#983); BC
  // decides. "At" counts as past it.
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
          <span className="text-muted-foreground">
            {sinceText(since, afterRun)}
          </span>
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
          ? 'Ai depășit pragul — ești candidat la promovare; BC decide'
          : `Mai ai ${formatPointCount(threshold - points)} până la pragul Voluntar Activ`}
      </p>
    </div>
  );
}
