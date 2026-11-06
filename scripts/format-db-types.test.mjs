// node:test suite for scripts/format-db-types.mjs (#1199). From CLI 2.122 the
// type generator prints its output unformatted. The formatter restores the
// layout 2.117 printed, and CI compares the committed file byte for byte with
// a fresh generation run through it.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { formatDbTypes } from "./format-db-types.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const committed = join(here, "..", "app", "src", "lib", "database.types.ts");

// The shape 2.122 prints: quoted keys, fields joined by commas on one line,
// odd indentation, no formatting at all.
const RAW = `
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {

  "public": {
          Tables: {
            "announcement_reads": {
                  Row: {
                    "announcement_id": number,"member_id": string,"read_at": string
                  }
                  ComputedFields: never
            }
          }
  }
}
`;

test("the committed types are already formatted, so CI's comparison can pass", async () => {
  const text = readFileSync(committed, "utf8");
  assert.equal(await formatDbTypes(text), text);
});

test("raw generator output comes out as 2.117 printed it: no semicolons, one field per line", async () => {
  const out = await formatDbTypes(RAW);
  assert.match(
    out,
    /^export type Json =\n {2}\| string\n {2}\| number\n/,
    "a long union breaks one member per line",
  );
  assert.match(
    out,
    /\n {8}Row: \{\n {10}announcement_id: number\n {10}member_id: string\n {10}read_at: string\n {8}\}\n/,
  );
  assert.doesNotMatch(out, /;\s*$/m, "no line ends with a semicolon");
  assert.doesNotMatch(out, /"announcement_reads"/, "keys that need no quotes lose them");
});

test("formatting is stable: formatting the output again changes nothing", async () => {
  const once = await formatDbTypes(RAW);
  assert.equal(await formatDbTypes(once), once);
});

test("the command line reads stdin and writes stdout", () => {
  const run = spawnSync(process.execPath, [join(here, "format-db-types.mjs")], {
    input: RAW,
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /\n {10}member_id: string\n/);
});

test("an empty input fails, so a generator that printed nothing never empties the file", () => {
  const run = spawnSync(process.execPath, [join(here, "format-db-types.mjs")], {
    input: "\n",
    encoding: "utf8",
  });
  assert.notEqual(run.status, 0);
  assert.equal(run.stdout, "");
  assert.match(run.stderr, /no types on stdin/);
});
