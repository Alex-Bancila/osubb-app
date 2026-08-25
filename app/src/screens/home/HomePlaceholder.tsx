import {
  IonButton,
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
} from '@ionic/react';
import { useAuth } from '../../lib/auth';

/* Placeholder for the dashboard. #84 replaces this with the real shell and
   navigation, #93–#95 with the actual dashboard cards. Until then it shows the
   claims the token carries, which is the quickest way to confirm that signing
   in as two different demo accounts really does produce two different sessions. */
export default function HomePlaceholder() {
  const { session, claims, signOut } = useAuth();

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>OSUBB</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <h1 style={{ fontSize: 'var(--fs-xl)', fontWeight: 'var(--fw-bold)' }}>
          Bun venit, {session?.user.email}
        </h1>
        <dl style={{ color: 'var(--text-muted)', lineHeight: 1.9 }}>
          <div>
            rol: <strong>{claims?.member_role}</strong> (nivel{' '}
            <strong>{claims?.member_level}</strong>)
          </div>
          <div>departamente: {claims?.dept_ids.join(', ') || '—'}</div>
          <div>echipe: {claims?.team_ids.join(', ') || '—'}</div>
        </dl>
        <IonButton onClick={signOut}>Deconectare</IonButton>
      </IonContent>
    </IonPage>
  );
}
