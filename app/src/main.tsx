import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';

/* Bundled official typeface (Montserrat variable) */
import '@fontsource-variable/montserrat';

/* Ours: the OSUBB tokens, then Tailwind, then the screen stylesheets. */
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
