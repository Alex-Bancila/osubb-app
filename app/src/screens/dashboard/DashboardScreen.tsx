import { IonContent, IonPage } from '@ionic/react';
import MyPointsCard from './MyPointsCard';
import LeaderboardCard from './LeaderboardCard';
import DeptCupCard from './DeptCupCard';
import { useMyProfile } from '../../queries/profile';
import { firstName, formatLongDate } from '../../lib/format';

/**
 * Acasă (#93–#95): where a member stands, in one screen.
 *
 * Only the gamification is here yet — "ce urmează săptămâna asta" and the
 * announcements column from the mockup arrive with the calendar (#96–#98) and
 * the feed (#99–#101), and an empty card promising them would be worse than
 * their absence.
 *
 * Each card owns its own query and its own loading, empty and error states.
 * That is deliberate: a leaderboard that fails should not blank out the total
 * next to it, and a page-level spinner would hold back three cards for the
 * slowest one.
 */
export default function DashboardScreen() {
  const profile = useMyProfile();
  const name = firstName(profile.data?.full_name);

  return (
    <IonPage>
      <IonContent>
        <div className="page">
          <header className="page-head">
            {/* No skeleton for the name: the greeting reads fine without it for
                the moment it takes, and "Salut, ▮▮▮▮" reads like a bug. */}
            <h1 className="page-title">Salut{name && `, ${name}`} 👋</h1>
            <p className="page-date">{formatLongDate(new Date())}</p>
          </header>

          <MyPointsCard />

          <div className="dash-grid">
            <LeaderboardCard />
            <DeptCupCard />
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
}
