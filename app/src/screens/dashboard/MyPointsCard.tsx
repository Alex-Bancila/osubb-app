import { ErrorState, Loading } from '../../components/states';
import { useMyPoints, useMyStanding } from '../../queries/points';
import { useMyProfile } from '../../queries/profile';
import { useRoles } from '../../queries/reference';
import { formatPoints } from '../../lib/format';

/**
 * #93 — the one card a member opens the app to see: their total, their role,
 * and where that puts them.
 *
 * The rank line is the point of it. A total on its own ("12 puncte") means
 * nothing to someone who does not know what 12 buys; "#4 din 8 · 3 puncte până
 * la locul 3" is the same number turned into something a person can act on
 * this week, and every part of it is read from the database rather than
 * estimated here.
 *
 * The spec also asks for the next automatic promotion threshold. There is no
 * `promotion_rules` table yet (#51/#52), and the issue says to hide the line
 * until there is — so it is absent rather than faked.
 *
 * `showStanding` mirrors the database's `seeLeadership` gate (level >= 5,
 * `20260907204817_leadership_only_global_points.sql`): below it, `leaderboard`
 * never returns this member's row, so `useMyStanding` is called with
 * `enabled: false` and its query stays disabled — `pending` forever rather
 * than resolving. The loading/error branches below must not wait on it in
 * that case, or an ordinary member would see a permanent spinner.
 */
export default function MyPointsCard({
  showStanding,
}: {
  showStanding: boolean;
}) {
  const points = useMyPoints();
  const standing = useMyStanding({ enabled: showStanding });
  const profile = useMyProfile();
  const roles = useRoles();

  if (points.isError || (showStanding && standing.isError)) {
    return (
      <section className="card hero">
        <ErrorState
          error={points.error ?? standing.error}
          onRetry={() => {
            void points.refetch();
            if (showStanding) void standing.refetch();
          }}
        />
      </section>
    );
  }

  if (points.isPending || (showStanding && standing.isPending)) {
    return (
      <section className="card hero">
        <Loading />
      </section>
    );
  }

  /* The role label comes from the `roles` table ("Membru cu Drept de Vot"),
     with the enum value as the fallback while it loads — never a blank chip. */
  const role = profile.data?.role;
  const roleLabel = (role && roles.data?.get(role)?.name) ?? role ?? '';

  return (
    <section className="card hero">
      <div className="hero-main">
        <span className="hero-label">Punctajul meu</span>
        <p className="hero-value">
          {formatPoints(points.data)}
          <span className="hero-unit">puncte</span>
        </p>
        <div className="hero-badges">
          {roleLabel && (
            <span className="role-badge">
              <span className="role-dot" aria-hidden="true" />
              {roleLabel}
            </span>
          )}
          {profile.data?.tier && (
            <span className="chip">{profile.data.tier}</span>
          )}
        </div>
      </div>

      {/* Below level 5, `leaderboard` never carries this member's row at all
          (ADR-0007's leadership-only ranking), so there is no "no rank" case
          to render here — only the fact that ranking is a leadership view,
          stated plainly rather than apologised for or promised later. */}
      {!showStanding ? (
        <div className="hero-rank">
          <p className="hero-rank-note">
            Clasamentul este vizibil pentru BCE și BC.
          </p>
        </div>
      ) : standing.data?.rank == null ? (
        /* No rank at all. This is the deactivation window from ADR-0003 made
           visible: `leaderboard` filters on `profiles.status`, which is live,
           while the claims that got this page open are up to an hour old — so
           for that hour a member deactivated mid-session still reads their
           own total and is correctly absent from the ranking. Verified by
           deactivating a seeded member with their session open. */
        <div className="hero-rank">
          <p className="hero-rank-note">Nu ești în clasament.</p>
        </div>
      ) : (
        <div className="hero-rank">
          <span className="hero-rank-value">
            <span className="hero-rank-hash">#</span>
            {standing.data.rank}
          </span>
          <span className="hero-rank-total">
            din {standing.data.total} membri
          </span>
          <p className="hero-rank-note">
            {standing.data.next
              ? `${formatPoints(standing.data.next.gap)} p până la locul ${standing.data.next.rank}`
              : 'Locul 1 🏆'}
          </p>
        </div>
      )}
    </section>
  );
}
