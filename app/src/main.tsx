import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// TODO(#692, #699, #700): goes with setupIonicReact() below.
import { setupIonicReact } from '@ionic/react';
import { QueryClientProvider } from '@tanstack/react-query';

/* TODO(#692, #699, #700): Ionic's four base stylesheets stay only because the
   Calendar (#692), Profil (#699) and Acasă (#700) screens still render
   `IonPage`/`IonContent`, which need them. The last of those three rebuilds to
   merge deletes these four imports, `setupIonicReact()` below, the `--ion-*`
   mapping in theme/global.css, and the `@ionic/react` and `ionicons`
   dependencies in package.json. */
import '@ionic/react/css/core.css';
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';

/* Bundled official typeface (Montserrat variable) */
import '@fontsource-variable/montserrat';

/* Ours, last, so the OSUBB palette wins over Ionic's defaults. */
import './theme/tokens.css';
import './theme/tailwind.css';
import './theme/global.css';
import './theme/screens.css';
import './theme/dashboard.css';
import './theme/calendar.css';

import { createQueryClient } from './queries/client';
import { AuthProvider } from './lib/auth';
import App from './App';
import { PwaUpdatePrompt } from './pwa/PwaUpdatePrompt';

/* TODO(#692, #699, #700): remove with the four base stylesheets above, when the
   last of the Calendar, Profil and Acasă rebuilds merges. */
setupIonicReact();

const queryClient = createQueryClient();

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
        <PwaUpdatePrompt />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
