#!/usr/bin/env node
// Formats `supabase gen types typescript` output the way the CLI printed it
// itself up to 2.117: Prettier, no semicolons (#1199). From 2.122 the CLI
// prints the types unformatted. The root package's exact Prettier pin does the
// work, so `npm run gen:types` (app/), scripts/check-local-ci.sh and CI's
// "Generated types match the schema" step print the same bytes. Options are
// passed in full and no config file is read: app/.prettierrc (single quotes,
// semicolons) must not reach a file CI compares byte for byte.
//
//   supabase gen types typescript --local | node scripts/format-db-types.mjs
import { fileURLToPath } from "node:url";
import { format } from "prettier";

export async function formatDbTypes(text) {
  return format(text, { parser: "typescript", semi: false });
}

// Read stdin as a stream, never with readFileSync(0): the generator connects
// to the database before it prints, and on Linux an empty non-blocking pipe
// makes a synchronous read fail with EAGAIN (PR #1205).
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const input = await readStdin();
  if (input.trim() === "") {
    process.stderr.write("format-db-types: no types on stdin\n");
    process.exit(1);
  }
  process.stdout.write(await formatDbTypes(input));
}
