import { IonButton, IonContent, IonPage } from '@ionic/react';
import { useAuth } from '../../lib/auth';
import { useSignOutAction } from '../../lib/use-sign-out-action';

/**
 * Signed in, but the token carries no org claims.
 *
 * This is not an error state and it must not look like one. It is ADR-0003
 * working: authentication and membership are two separate gates, and someone
 * can pass the first without the second — never invited, invited but not yet
 * provisioned, or deactivated since their token was issued. The database
 * answers them with zero rows, so the alternative to this screen is a perfectly
 * functional app that is empty everywhere, which reads as broken.
 */
export default function NoProfileScreen() {
  const { session, signOut } = useAuth();
  const signOutAction = useSignOutAction(signOut);

  return (
    <IonPage>
      <IonContent className="ion-padding">
        <div className="auth-card">
          <h1>Contul tău nu este activ</h1>
          <p>
            Ești conectat ca <strong>{session?.user.email}</strong>, dar nu ai
            (încă) un profil activ în organizație, așa că nu îți putem arăta
            nimic.
          </p>
          <p className="muted">
            Dacă tocmai ai fost invitat, s-ar putea ca profilul să fie în curs
            de creare — încearcă din nou peste câteva minute. Altfel, scrie-i
            unui membru BC: doar ei pot crea sau reactiva un cont.
          </p>
          <IonButton
            fill="outline"
            disabled={signOutAction.pending}
            aria-describedby={
              signOutAction.error ? 'sign-out-error' : undefined
            }
            onClick={() => void signOutAction.run()}
          >
            {signOutAction.pending ? 'Se deconectează…' : 'Deconectare'}
          </IonButton>
          {signOutAction.error && (
            <p id="sign-out-error" className="auth-error" role="alert">
              {signOutAction.error}
            </p>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
}
