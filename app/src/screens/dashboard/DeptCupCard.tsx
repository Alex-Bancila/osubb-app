import { ribbonOutline } from 'ionicons/icons';
import { IonIcon } from '@ionic/react';
import type { CSSProperties } from 'react';
import { Empty, ErrorState, Loading } from '../../components/states';
import { useDeptCup } from '../../queries/points';
import { useDepartments } from '../../queries/reference';
import { formatPoints } from '../../lib/format';

/**
 * #95 — Cupa Departamentelor: the standings, each department in its own brand
 * colour.
 *
 * The colour is a column on `departments` (Brand Book 2025), not a map in this
 * file, so a sixth department is an insert and this card already knows what it
 * looks like.
 *
 * Bars are scaled against the leader, which is the comparison the cup is
 * about — a department on 24 points next to one on 26 should look like a race.
 * A department in the negative (sanctions outweighing awards) shows no bar and
 * its real, negative total: the number is the honest one, and a bar pointing
 * backwards would be a novelty rather than information.
 *
 * Known gap, tracked as #134: `dept_cup` inner-joins `member_departments`, so a
 * department with no members is missing from this list entirely rather than
 * showing zero. That is a view to fix, not something to paper over here.
 */
export default function DeptCupCard() {
  const cup = useDeptCup();
  const departments = useDepartments();

  const max = Math.max(1, ...(cup.data ?? []).map((row) => row.points ?? 0));

  return (
    <section className="card">
      <header className="card-head">
        <h2 className="card-title">
          <IonIcon icon={ribbonOutline} aria-hidden="true" />
          Cupa Departamentelor
        </h2>
      </header>

      {cup.isPending ? (
        <Loading />
      ) : cup.isError ? (
        <ErrorState error={cup.error} onRetry={() => void cup.refetch()} />
      ) : cup.data.length === 0 ? (
        <Empty text="Niciun departament nu are încă puncte." />
      ) : (
        <ul className="cup-list">
          {cup.data.map((row) => {
            const dept = row.dept_id
              ? departments.data?.get(row.dept_id)
              : undefined;
            const points = row.points ?? 0;
            const width = `${Math.round((Math.max(0, points) / max) * 100)}%`;

            return (
              <li
                key={row.dept_id}
                /* The department's colour reaches CSS as a variable so the
                   tag's tint can be mixed from it there, instead of hardcoding
                   an alpha value into an inline style. */
                style={
                  { '--dept': dept?.color ?? 'var(--ink-400)' } as CSSProperties
                }
              >
                <span className="cup-tag">{dept?.short ?? row.dept_id}</span>
                <div className="cup-body">
                  <div className="cup-line">
                    <span className="cup-name">{dept?.name ?? row.name}</span>
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
