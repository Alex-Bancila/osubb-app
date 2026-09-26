import { readAdminEnv } from "../invite-member/deps.ts";
import { realCsvImportDeps } from "./deps.ts";
import { handleCsvImport } from "./handler.ts";

// Read once at boot: with no secret key the function refuses to start, and
// the boot error names the fix (#796).
const env = readAdminEnv("csv-import");

Deno.serve((request) =>
  handleCsvImport(request, realCsvImportDeps(request, env))
);
