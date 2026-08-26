import { IonContent, IonPage } from '@ionic/react';
import { useLeaderboard, useMyPoints } from '../../queries/points';
import { Empty, ErrorState, Loading } from '../../components/states';
import { formatPoints } from '../../lib/format';

/* Deliberately plain: this exists to show the query layer returning live data
   (#87). The designed cards — tier, rank, the department cup — are #93–#95, and
   they replace this. */
export default function DashboardScreen() {
  const points = useMyPoints();
  const board = useLeaderboard(5);

  return (
    <IonPage>
      <IonContent className="ion-padding">
        <section className="card">
          <h2 className="card-title">Punctele mele</h2>
          {points.isPending ? (
            <Loading />
          ) : points.isError ? (
            <ErrorState error={points.error} onRetry={() => points.refetch()} />
          ) : (
            <p className="bignum">{formatPoints(points.data)}</p>
          )}
        </section>

        <section className="card">
          <h2 className="card-title">Clasament</h2>
          {board.isPending ? (
            <Loading />
          ) : board.isError ? (
            <ErrorState error={board.error} onRetry={() => board.refetch()} />
          ) : board.data.length === 0 ? (
            <Empty text="Nimeni nu are încă puncte." />
          ) : (
            /* Every column off a view arrives as `| null`: Postgres cannot
               prove non-nullability through a join and an aggregate, so the
               generator does not claim it either. The fallbacks are honest
               rather than defensive noise — a member with no ledger rows really
               does sum to nothing. */
            <ol className="rank-list">
              {board.data.map((row) => (
                <li key={row.member_id ?? row.full_name}>
                  <span className="rank">{row.rank ?? '—'}</span>
                  <span className="rank-name">{row.full_name ?? '—'}</span>
                  <span className="rank-points">
                    {formatPoints(row.points ?? 0)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </IonContent>
    </IonPage>
  );
}
