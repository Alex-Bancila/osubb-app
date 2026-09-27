// Entry point. All logic lives in handler.ts so it can be tested without a
// server, a database or Resend; this file only wires the real ones.
import { handleSendDigest } from "./handler.ts";
import { realDeps } from "./deps.ts";

Deno.serve((req: Request) => handleSendDigest(req, realDeps()));
