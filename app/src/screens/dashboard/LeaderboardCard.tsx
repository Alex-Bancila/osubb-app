import { trophyOutline } from 'ionicons/icons';
import { IonIcon } from '@ionic/react';
import { Empty, ErrorState, Loading } from '../../components/states';
import { useLeaderboard, useMyStanding } from '../../queries/points';
import { useMyProfile } from '../../queries/profile';
import { useAuth } from '../../lib/auth';
import { formatPoints } from '../../lib/format';
import { MemberName } from '../../components/member/MemberName';

type Row = {
  member_id: string;
  full_name: string | null;
  nickname?: string | null;
  points: number | null;
  rank: number | null;
};

/**
 * One row of the board: rank, the Member's name button, points. `isMe` drives
 * both the highlight and the avatar colour — the board carries no colour for
 * anyone else, so everyone but me gets the neutral default rather than an
 * invented one (the Member Card shows their own once opened).
 */
function RankRow({
  row,
  isMe,
  color,
}: {
  row: Row;
  isMe: boolean;
  color?: string | null;
}) {
  return (
    <li className={isMe ? 'is-me' : undefined}>
      {/* Top three in brand red, the rest muted — the podium reads before the
          numbers do. */}
      <span
        className={`rank${(row.rank ?? 99) <= 3 ? ' rank--top' : ''}`}
        aria-label={`Locul ${row.rank ?? '—'}`}
      >
        {row.rank ?? '—'}
      </span>
      <span className="rank-member">
        <MemberName
          size="sm"
          className="font-medium"
          memberId={row.member_id}
          nickname={row.nickname}
          fullName={row.full_name ?? 'Membru OSUBB'}
          avatarColor={(isMe && color) || 'var(--ink-700)'}
        />
        {isMe && <span className="tag tag--me">tu</span>}
      </span>
      <span className="rank-points">{formatPoints(row.points ?? 0)}</span>
    </li>
  );
}

/**
 * #94 — the top ten, with my row marked wherever it is.
 *
 * Two details carry the whole card:
 *
 *  - `rank` is the database's, so ties tie: three members on 15 points are all
 *    rank 1 and the next is rank 4. An array index would have numbered them
 *    1, 2, 3 and quietly told two of them they were losing.
 *  - a member outside the top ten still sees themselves, pinned under a break.
 *    With eight demo accounts nobody is; with two hundred members almost
 *    everybody is, and a leaderboard you cannot find yourself on is a poster,
 *    not a game.
 */
export default function LeaderboardCard() {
  const board = useLeaderboard(10);
  const standing = useMyStanding();
  const profile = useMyProfile();
  const { session } = useAuth();
  const myId = session?.user.id ?? null;

  const inTopTen = board.data?.some((row) => row.member_id === myId) ?? false;
  const pinned = !inTopTen ? (standing.data?.mine ?? null) : null;

  return (
    <section className="card">
      <header className="card-head">
        <h2 className="card-title">
          <IonIcon icon={trophyOutline} aria-hidden="true" />
          Clasament
        </h2>
      </header>

      {board.isPending ? (
        <Loading />
      ) : board.isError ? (
        <ErrorState error={board.error} onRetry={() => void board.refetch()} />
      ) : board.data.length === 0 ? (
        <Empty text="Nimeni nu are încă puncte." />
      ) : (
        <>
          <ol className="rank-list">
            {board.data.map((row) => (
              <RankRow
                key={row.member_id ?? row.full_name}
                row={row}
                isMe={row.member_id === myId}
                color={profile.data?.avatar_color}
              />
            ))}
          </ol>
          {pinned && (
            <>
              <div className="rank-break" aria-hidden="true">
                ⋯
              </div>
              <ol className="rank-list">
                <RankRow row={pinned} isMe color={profile.data?.avatar_color} />
              </ol>
            </>
          )}
        </>
      )}
    </section>
  );
}
