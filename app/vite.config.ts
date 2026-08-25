import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    /* Ionic's React wrappers are ~1.2 MB raw (~280 kB gzipped) before we write a
       single screen, so Vite's 500 kB default fires on every build and stops
       meaning anything. Raised so the warning is worth reading again — it should
       come back down once the router (#84) lets us lazy-load screens per route. */
    chunkSizeWarningLimit: 1500,
  },
});
