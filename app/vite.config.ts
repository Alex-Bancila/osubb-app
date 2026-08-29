import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
  server: {
    /* Pinned, and `strictPort` so a busy port is an error rather than a silent
       move to 5174. Magic links only come back to an origin on GoTrue's
       allow-list (supabase/config.toml), and 5174 is not on it — so drifting
       would produce a login that fails for a reason nothing on screen explains.
       Better to be told the port is taken. */
    port: 5173,
    strictPort: true,
  },
  build: {
    /* A budget, not a moving target. Ionic's React wrappers plus supabase-js and
       the router are ~1.6 MB raw (~355 kB gzipped) before we write a real
       screen, so Vite's 500 kB default fires on every build and stops meaning
       anything. 2 MB (~450 kB gzipped) is roughly what we are willing to send a
       member on mobile data for a first visit.

       When a build crosses it, the answer is route-level code splitting —
       `React.lazy` per screen, once there are ten of them and the saving is
       real — not another bump of this number. */
    chunkSizeWarningLimit: 2000,
  },
});
