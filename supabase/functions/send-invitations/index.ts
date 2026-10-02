// Entry point. All logic lives in handler.ts so it can be tested without a
// server or a database; this file only wires the real clients (deps.ts).
import { readAdminEnv, realDeps } from "./deps.ts";
import { handleSendInvitations } from "./handler.ts";

// Read once at boot: with no secret key the function refuses to start (#796).
const env = readAdminEnv("send-invitations");

Deno.serve((req) => handleSendInvitations(req, realDeps(req, env)));
