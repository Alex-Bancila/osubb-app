// Entry point. All logic lives in handler.ts so it can be tested without a
// server or a database; this file only wires the real clients (deps.ts).
import { handleInvite } from "./handler.ts";
import { realDeps } from "./deps.ts";

Deno.serve((req: Request) => handleInvite(req, realDeps(req)));
