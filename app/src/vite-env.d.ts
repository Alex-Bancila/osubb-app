/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

/* Typing the env we actually use, so a typo in `import.meta.env.VITE_SUPABSE_URL`
   is a build error instead of `undefined` at runtime. */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /* The environment's VAPID public key (ADR-0010, #704). Optional: without it
     the Profil switch says push is not available yet, and the rest works. */
  readonly VITE_VAPID_PUBLIC_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
