// Entry point. All logic lives in handler.ts so it can be tested without a
// server or a database; this file only wires the real ones.
import { handleResendWebhook } from "./handler.ts";
import { realDeps } from "./deps.ts";

Deno.serve((req: Request) => handleResendWebhook(req, realDeps()));
