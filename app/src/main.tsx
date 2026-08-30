import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { setupIonicReact } from '@ionic/react';
import { QueryClientProvider } from '@tanstack/react-query';

/* Ionic's own stylesheets, imported once here and never in a screen.
   `core` is required; the next three are the base layer its components assume
   (resets, layout structure, type scale). */
import '@ionic/react/css/core.css';
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';

/* The utility classes every Ionic example uses — `ion-padding`, `ion-text-center`,
   `ion-hide` and friends. They are a couple of KB in total, and leaving them out
   makes those classes silently do nothing, which is a nasty first hour for
   someone following the Ionic docs. Same set `ionic start` generates. */
import '@ionic/react/css/padding.css';
import '@ionic/react/css/float-elements.css';
import '@ionic/react/css/text-alignment.css';
import '@ionic/react/css/text-transformation.css';
import '@ionic/react/css/flex-utils.css';
import '@ionic/react/css/display.css';

/* Ours, last, so the OSUBB palette wins over Ionic's defaults. */
import './theme/tokens.css';
import './theme/global.css';
import './theme/auth-screens.css';
import './theme/shell.css';
import './theme/screens.css';
import './theme/dashboard.css';
import './theme/calendar.css';

import { createQueryClient } from './queries/client';
import { AuthProvider } from './lib/auth';
import App from './App';

setupIonicReact();

const queryClient = createQueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
