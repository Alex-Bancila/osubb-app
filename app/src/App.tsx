import {
  IonApp,
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
} from '@ionic/react';

/* Scaffold placeholder only — it exists to prove tokens.css is loaded and the
   palette is the Brand Book one. Real department colours come from the
   `departments` table, never from a list in the code (mini-spec §6); the first
   screen that needs them reads them through a query hook. */
const SWATCHES = [
  ['Brand', '--red'],
  ['Educational', '--dept-edu'],
  ['Imagine & PR', '--dept-pr'],
  ['Tineret', '--dept-youth'],
  ['Financiar', '--dept-fin'],
  ['Resurse Umane', '--dept-hr'],
] as const;

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
          <h1
            style={{ fontSize: 'var(--fs-xl)', fontWeight: 'var(--fw-bold)' }}
          >
            Scheletul aplicației funcționează
          </h1>
          <p style={{ color: 'var(--text-muted)', maxWidth: '38rem' }}>
            Vite + React + TypeScript + Ionic, cu paleta OSUBB încărcată din{' '}
            <code>src/theme/tokens.css</code>. Ecranele reale încep de la
            issue-ul #82 (clientul Supabase și sesiunea), apoi #83 (login) și
            #84 (shell + navigație).
          </p>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--s-3)',
              marginTop: 'var(--s-6)',
            }}
          >
            {SWATCHES.map(([label, token]) => (
              <div
                key={token}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--s-2)',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-pill)',
                  padding: 'var(--s-2) var(--s-4)',
                  fontSize: 'var(--fs-sm)',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    background: `var(${token})`,
                  }}
                />
                {label}
              </div>
            ))}
          </div>
        </IonContent>
      </IonPage>
    </IonApp>
  );
}
