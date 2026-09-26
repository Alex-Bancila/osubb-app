// Entry point. All logic lives in handler.ts so it can be tested without a
// server or a database; this file only wires the real clients (deps.ts).
import { handleInvite } from "./handler.ts";
import { readAdminEnv, realDeps } from "./deps.ts";

// Read once at boot: with no secret key the function refuses to start, and
// the boot error names the fix (#796).
const env = readAdminEnv("invite-member");

Deno.serve((req: Request) => handleInvite(req, realDeps(req, env)));
