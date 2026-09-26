import { Award } from 'lucide-react';
import type { CSSProperties } from 'react';
import { Empty, ErrorState, Loading } from '../../components/states';
import { useDeptCup } from '../../queries/points';
import { useGroups } from '../../queries/reference';
import { formatPoints } from '../../lib/format';

/**
 * #95 — Cupa Departamentelor: the standings, each department in its own brand
 * colour.
 *
 * The name, the short tag and the colour come from the competing Department's
 * **Group** (Brand Book 2025 values, carried on `public.groups`), not from a
 * map in this file, so a sixth department is an insert and this card already
 * knows what it looks like.
 *
 * Bars are scaled against the leader, which is the comparison the cup is
 * about — a department on 24 points next to one on 26 should look like a race.
 * A department in the negative shows no bar and its real, negative total: the
 * number is the honest one, and a bar pointing backwards would be a novelty
 * rather than information.
 *
 * #259 closed the old #134 gap: `dept_cup` no longer inner-joins
 * `member_departments`, so every competing Department is a row even on zero,
 * and its total is now the Task Points whose Task Origin is that Department or
 * one of its Department Teams — not its current members' whole ledgers. A
 * negative total is still reachable (a Rating of 1 subtracts points), but a
 * member's sanction no longer reaches the Cup at all.
 */
export default function DeptCupCard() {
  const cup = useDeptCup();
  const groups = useGroups();

  const max = Math.max(1, ...(cup.data ?? []).map((row) => row.points ?? 0));

  // #200 — a row exists the instant `dept_cup` resolves, but its Group may
  // not: `groups` is a second, independent query. Rendering rows as soon as
  // `cup` settles, while `groups` is still in flight, is exactly how a raw
  // legacy id ('edu', 'pr', …) used to flash on screen before its Group's
  // name and colour arrived. Waiting on both — the same shape `MyPointsCard` already uses for its own two
  // queries — means no row is ever painted before its Group lookup can
  // answer, so there is no frame in which a raw id is the fallback.
  const isPending = cup.isPending || groups.isPending;

  return (
    <section className="card">
      <header className="card-head">
        <h2 className="card-title">
          <Award className="card-title-icon" aria-hidden="true" />
          Cupa Departamentelor
        </h2>
      </header>

      {isPending ? (
        <Loading />
      ) : cup.isError ? (
        <ErrorState error={cup.error} onRetry={() => void cup.refetch()} />
      ) : cup.data.length === 0 ? (
        <Empty text="Niciun departament nu are încă puncte." />
      ) : (
        <ul className="cup-list">
          {cup.data.map((row) => {
            const group =
              row.group_id === null
                ? undefined
                : groups.data?.get(row.group_id);
            const points = row.points ?? 0;
            const width = `${Math.round((Math.max(0, points) / max) * 100)}%`;

            return (
              <li
                key={row.group_id}
                /* The Group's colour reaches CSS as a variable so the tag's
                   tint can be mixed from it there, instead of hardcoding an
                   alpha value into an inline style. */
                style={
                  {
                    '--dept': group?.color ?? 'var(--ink-400)',
                  } as CSSProperties
                }
              >
                {/* A Group id matching no readable Group (RLS withheld it) is
                    not a name — '—' is the same neutral ink-coloured fallback
                    the row's colour already takes, never a raw id and never a
                    second, hard-coded department map. */}
                <span className="cup-tag">{group?.short ?? '—'}</span>
                <div className="cup-body">
                  <div className="cup-line">
                    <span className="cup-name">{group?.name ?? row.name}</span>
                    <span className="cup-points">{formatPoints(points)}</span>
                  </div>
                  <div className="cup-track">
                    <div className="cup-bar" style={{ width }} />
                  </div>
                </div>
                <span className="cup-members">
                  {row.members ?? 0}
                  <span className="cup-members-unit">
                    {row.members === 1 ? ' membru' : ' membri'}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
