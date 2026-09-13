import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';
import { createPwaOptions } from './src/pwa/pwa-config.ts';

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA(
      createPwaOptions(
        loadEnv(mode, import.meta.dirname, 'VITE_').VITE_SUPABASE_URL ??
          'http://127.0.0.1:54321',
      ),
    ),
  ],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    /* `restoreMocks` alone resets a spy's implementation but — for a plain
       `vi.fn()` created once at module scope (the `vi.hoisted()` pattern every
       mocked-module test file here uses) — does not clear its call history
       between tests in this Vitest version. `clearMocks` does, and is what the
       removed per-file `vi.clearAllMocks()` calls were actually relied on for. */
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.*', 'src/test/**', 'src/lib/database.types.ts'],
      thresholds: {
        'src/App.tsx': { lines: 100 },
        'src/lib/auth-error-message.ts': { lines: 100 },
        'src/lib/capabilities.ts': { lines: 100 },
      },
    },
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
    /* A budget, not a moving target. supabase-js, the router and the Ionic
       wrappers that ADR-0002 retires route by route are ~1.6 MB raw (~355 kB
       gzipped) before we write a real screen, so Vite's 500 kB default fires on
       every build and stops meaning anything. 2 MB (~450 kB gzipped) is roughly what we are willing to send a
       member on mobile data for a first visit.

       When a build crosses it, the answer is route-level code splitting —
       `React.lazy` per screen, once there are ten of them and the saving is
       real — not another bump of this number. */
    chunkSizeWarningLimit: 2000,
  },
}));
