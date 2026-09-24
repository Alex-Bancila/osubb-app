// Entry point. All logic lives in handler.ts so it can be tested without a
// server, a database or a push service; this file only wires the real ones.
import { handleSendPush } from "./handler.ts";
import { realDeps } from "./deps.ts";

Deno.serve((req: Request) => handleSendPush(req, realDeps()));
