import { realCsvImportDeps } from "./deps.ts";
import { handleCsvImport } from "./handler.ts";

Deno.serve((request) => handleCsvImport(request, realCsvImportDeps(request)));
