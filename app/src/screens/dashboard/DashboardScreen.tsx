import { useEffect, useState } from 'react';
import MyPointsCard from './MyPointsCard';
import LeaderboardCard from './LeaderboardCard';
import DeptCupCard from './DeptCupCard';
import NextTaskCard from './NextTaskCard';
import NextEventCard from './NextEventCard';
import { useMyProfile } from '../../queries/profile';
import { useCapability } from '../../lib/capabilities';
import { firstName, formatLongDate } from '../../lib/format';

/**
 * Acasă (#93–#95, #700): where a member stands, and what is next for them.
 *
 * Every Member sees their total, then **Următorul task** and **Următorul
 * eveniment** (ruling R4) — each a deep link into the page that holds it.
 * Leadership (`seeLeadership`) also sees the Clasament and the Cupa
 * Departamentelor, unchanged.
 *
 * Each card owns its own query and its own loading, empty and error states.
 * That is deliberate: a leaderboard that fails should not blank out the total
 * next to it, and a page-level spinner would hold back every card for the
 * slowest one.
 */
export default function DashboardScreen() {
  const profile = useMyProfile();
  const name = firstName(profile.data?.full_name);
  // The server's `see_leadership` capability, the same rank gate the database
  // enforces on `leaderboard`, `dept_cup` and `member_points`: an ordinary
  // member never gets rows back from those views, so there is nothing here for
  // the cards to show and no query worth firing for them.
  const leader = useCapability('seeLeadership').data === true;
  // One clock for both next-item cards, so "overdue" and "has it started"
  // follow the wall while the page stays open.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section className="w-full" aria-labelledby="dashboard-title">
      <div className="page">
        <header className="page-head">
          {/* No skeleton for the name: the greeting reads fine without it for
              the moment it takes, and "Salut, ▮▮▮▮" reads like a bug. */}
          <h1 id="dashboard-title" className="page-title">
            Salut{name && `, ${name}`} 👋
          </h1>
          <p className="page-date">{formatLongDate(now)}</p>
        </header>

        <MyPointsCard showStanding={leader} />

        <div className="next-grid">
          <NextTaskCard now={now} />
          <NextEventCard now={now} />
        </div>

        {leader && (
          <div className="dash-grid">
            <LeaderboardCard />
            <DeptCupCard />
          </div>
        )}
      </div>
    </section>
  );
}
