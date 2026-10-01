// Entry point. All logic lives in handler.ts so it can be tested without a
// server or a database; this file only wires the real clients (deps.ts).
import { handleRequestInvitation } from "./handler.ts";
import { readAdminEnv, realDeps } from "./deps.ts";

// Read once at boot: with no secret key the function refuses to start, and
// the boot error names the fix (#796). The admin client is built once too —
// there is no caller session to carry per request.
const deps = realDeps(readAdminEnv("request-invitation"));

Deno.serve((req: Request) => handleRequestInvitation(req, deps));
