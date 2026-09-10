// Shared CORS headers for browser-called functions (the BC panel calls these
// from the app origin). Kept in one place so invite-member and the CSV import
// (#72) cannot drift apart.
//
// Origin-aware allow-list (#378): the app no longer answers
// `Access-Control-Allow-Origin: *`. Set ALLOWED_ORIGINS (comma-separated) in
// the function's environment; unset it locally and Vite's default origin
// applies. See docs/backend/inviting.md for the hosted deployment story.

const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:5173"];

export function allowedOrigins(): string[] {
  const raw = Deno.env.get("ALLOWED_ORIGINS");
  const list = raw?.split(",").map((o) => o.trim()).filter(Boolean) ?? [];
  return list.length > 0 ? list : DEFAULT_ALLOWED_ORIGINS;
}

export function isAllowedOrigin(origin: string | null): boolean {
  return origin !== null && allowedOrigins().includes(origin);
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = isAllowedOrigin(origin);
  return {
    // Origin decides these headers, so every response varies on it — including
    // the ones that get no Access-Control-Allow-Origin, or a shared cache could
    // replay a rejected origin's response to an allowed one.
    "Vary": "Origin",
    ...(allowed ? { "Access-Control-Allow-Origin": origin as string } : {}),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

export function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}
