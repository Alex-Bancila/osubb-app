import {
  IonApp,
  IonButton,
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
} from '@ionic/react';
import { useAuth } from './lib/auth';

/* Still a placeholder — the real shell, navigation and routes are #84/#85.
   What it does now is show the three session states this app has, because
   those three are the whole point of #82 and each one gets a real screen
   later: signed out (#83), signed in without membership (#85), signed in as a
   member (everything else). */
function SessionReadout() {
  const { session, claims, loading, signOut } = useAuth();

  if (loading) return <p>Se încarcă…</p>;

  if (!session) {
    return (
      <>
        <h1 style={{ fontSize: 'var(--fs-xl)', fontWeight: 'var(--fw-bold)' }}>
          Nu ești autentificat
        </h1>
        <p style={{ color: 'var(--text-muted)' }}>
          Ecranul de login (link magic) este issue-ul #83. Până atunci, poți
          testa sesiunea din consolă:{' '}
          <code>
            await __supabase.auth.signInWithPassword(&#123; email:
            &apos;voluntar@demo.osubb&apos;, password: &apos;parola123&apos;
            &#125;)
          </code>
        </p>
      </>
    );
  }

  /* Signed in, but the token carries no org claims: never invited, or
     deactivated since it was issued. Not an error — ADR-0003 working. The kind
     version of this screen is #85. */
  if (!claims) {
    return (
      <>
        <h1 style={{ fontSize: 'var(--fs-xl)', fontWeight: 'var(--fw-bold)' }}>
          Contul tău nu este activ
        </h1>
        <p style={{ color: 'var(--text-muted)' }}>
          Ești autentificat ca <strong>{session.user.email}</strong>, dar nu ai
          un profil activ în organizație. Contactează BC.
        </p>
        <IonButton onClick={signOut}>Deconectare</IonButton>
      </>
    );
  }

  return (
    <>
      <h1 style={{ fontSize: 'var(--fs-xl)', fontWeight: 'var(--fw-bold)' }}>
        Bun venit, {session.user.email}
      </h1>
      <dl style={{ color: 'var(--text-muted)', lineHeight: 1.9 }}>
        <div>
          rol: <strong>{claims.member_role}</strong> (nivel{' '}
          <strong>{claims.member_level}</strong>)
        </div>
        <div>departamente: {claims.dept_ids.join(', ') || '—'}</div>
        <div>echipe: {claims.team_ids.join(', ') || '—'}</div>
      </dl>
      <IonButton onClick={signOut}>Deconectare</IonButton>
    </>
  );
}

export default function App() {
  return (
    <IonApp>
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonTitle>OSUBB</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">
          <SessionReadout />
        </IonContent>
      </IonPage>
    </IonApp>
  );
}
