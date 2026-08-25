import { IonContent, IonPage } from '@ionic/react';

/**
 * Stands in for a screen that has not been built yet, and says which issue
 * builds it. One component rather than seven near-empty files: each route gets
 * its own folder when there is something real to put in it (mini-spec §2).
 */
export default function Placeholder({
  title,
  issue,
  children,
}: {
  title: string;
  issue: string;
  children?: React.ReactNode;
}) {
  return (
    <IonPage>
      <IonContent className="ion-padding">
        <h1 style={{ fontSize: 'var(--fs-xl)', fontWeight: 'var(--fw-bold)' }}>
          {title}
        </h1>
        {children}
        <p style={{ color: 'var(--text-muted)', maxWidth: '34rem' }}>
          Ecranul se construiește în {issue}. Navigația, permisiunile și datele
          din spate funcționează deja — lipsește doar ce vezi aici.
        </p>
      </IonContent>
    </IonPage>
  );
}
