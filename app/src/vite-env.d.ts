/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

/* Typing the env we actually use, so a typo in `import.meta.env.VITE_SUPABSE_URL`
   is a build error instead of `undefined` at runtime. */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
