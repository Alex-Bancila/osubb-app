// scripts/import-legacy-tasks.mjs -- #1049: the one-time Legacy Import.
//
// Feeds the prepared import file (kept OUTSIDE this repository: it holds
// Members' names) to public.import_legacy_tasks in batches, then reads the
// totals back and compares them with the file. Contract, checks and recovery:
// docs/backend/legacy-task-import.md. A one-shot script: after the verified
// production run it is never run again (CLAUDE.md, house rule 9).
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export const BATCH_SIZE = 100;
/** Base points of the ten Difficulty levels (ADR-0007, #985). */
export const BASE_POINTS = {
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 6,
  7: 7,
  8: 8,
  9: 15,
  10: 20,
};
const DEFAULT_NOTE = "Importat din Task Tracker.";

/** The command said no (a 4xx answer): nothing of that call was written. */
export class RefusedError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** The statement was cancelled (57014): the call rolled back, nothing of it was written. */
export class TimedOutError extends Error {}

/** A sheet date as the trackers hold it: M/D/YYYY, or D.M.YYYY where someone typed it. */
export function parseSheetDate(text) {
  const value = String(text ?? "").trim();
  if (value === "") return null;
  let year;
  let month;
  let day;
  const slashed = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const dotted = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (slashed) [, month, day, year] = slashed;
  else if (dotted) [, day, month, year] = dotted;
  else throw new Error(`unreadable date "${value}"`);
  const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) {
    throw new Error(`unreadable date "${value}"`);
  }
  return iso;
}

function where(row) {
  return `${row.tracker_id} row ${row.sheet_row}`;
}

function rowPoints(row) {
  return BASE_POINTS[row.difficulty_level] * (row.rating - 2);
}

/** One row of import-set.json as one element of p_rows. Throws, naming the row, on what the file must fix. */
export function toCommandRow(row) {
  if (!Number.isInteger(row.group_id)) {
    throw new Error(`${where(row)}: its Group is not set (${row.group})`);
  }
  if (
    !(row.difficulty_level in BASE_POINTS) ||
    ![1, 2, 3, 4, 5].includes(row.rating)
  ) {
    throw new Error(
      `${where(row)}: Difficulty ${row.difficulty_level} / Rating ${row.rating} cannot be evaluated`,
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row.completed_on ?? ""))) {
    throw new Error(
      `${where(row)}: unreadable completion date "${row.completed_on}"`,
    );
  }
  let deadline;
  try {
    deadline = parseSheetDate(row.deadline);
  } catch (error) {
    throw new Error(`${where(row)}: ${error.message}`);
  }
  return {
    tracker_id: row.tracker_id,
    sheet_row: row.sheet_row,
    sheet_id: row.sheet_id ?? null,
    group_id: row.group_id,
    executor_id: row.profile_id,
    title: row.title,
    description: row.full_title ?? null,
    difficulty: row.difficulty_level,
    rating: row.rating,
    outcome: row.sheet_status === "Nerealizat" ? "unfulfilled" : "completed",
    completed_on: row.completed_on,
    deadline_on: deadline,
    note: String(row.observations ?? "").trim() || DEFAULT_NOTE,
  };
}

/** What the file says the database must hold after the run. */
export function planTotals(rows) {
  const totals = {
    rows: 0,
    points: 0,
    groups: {},
    members: {},
    from: null,
    to: null,
  };
  for (const row of rows) {
    const points = rowPoints(row);
    totals.rows += 1;
    totals.points += points;
    for (const [bucket, id] of [
      ["groups", String(row.group_id)],
      ["members", row.profile_id],
    ]) {
      totals[bucket][id] ??= { rows: 0, points: 0 };
      totals[bucket][id].rows += 1;
      totals[bucket][id].points += points;
    }
    if (totals.from === null || row.completed_on < totals.from)
      totals.from = row.completed_on;
    if (totals.to === null || row.completed_on > totals.to)
      totals.to = row.completed_on;
  }
  return totals;
}

/** The three calls the script makes, all with the secret key (service_role). */
export function createClient({ url, secretKey, fetchImpl }) {
  const base = url.replace(/\/+$/, "");
  const request = async (method, path, body) => {
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers: {
        apikey: secretKey,
        Authorization: `Bearer ${secretKey}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let data = null;
    if (text !== "") {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!response.ok) {
      const code = String(data?.code ?? "");
      // Three different things, and the operator does three different things
      // about them. A 4xx is the command (or PostgREST) saying no: nothing was
      // written. A cancelled statement rolled back. Anything else -- a 5xx, a
      // gateway page -- says nothing about whether the call committed.
      if (code === "57014") throw new TimedOutError("57014");
      if (response.status >= 400 && response.status < 500) {
        throw new RefusedError(
          response.status,
          code,
          String(data?.message ?? text),
          String(data?.details ?? ""),
        );
      }
      throw new Error(`HTTP ${response.status}`);
    }
    return data;
  };
  return {
    profilesByEmail: (email) =>
      request(
        "GET",
        `/rest/v1/profiles?select=id,email,role,status&email=eq.${encodeURIComponent(email)}`,
      ),
    importBatch: (actorId, rows, dryRun) =>
      request("POST", "/rest/v1/rpc/import_legacy_tasks", {
        p_actor: actorId,
        p_rows: rows,
        p_dry_run: dryRun,
      }),
    totals: () => request("POST", "/rest/v1/rpc/legacy_task_import_totals", {}),
  };
}

function compareTotals(plan, actual) {
  const mismatches = [];
  // The Evaluations, then what totals and Clasament actually read -- the
  // ledger -- then the days the work is dated on.
  for (const [label, expected, found] of [
    ["rows", plan.rows, actual.rows],
    ["points", plan.points, actual.points],
    ["ledger rows", plan.rows, actual.ledger_rows],
    ["ledger points", plan.points, actual.ledger_points],
    ["first completion day", plan.from, actual.from],
    ["last completion day", plan.to, actual.to],
  ]) {
    if (expected !== found) {
      mismatches.push(
        `MISMATCH ${label}: the file has ${expected}, the database has ${found}`,
      );
    }
  }
  for (const [bucket, label] of [
    ["groups", "Group"],
    ["members", "Member"],
  ]) {
    const ids = new Set([
      ...Object.keys(plan[bucket]),
      ...Object.keys(actual[bucket] ?? {}),
    ]);
    for (const id of [...ids].sort()) {
      const expected = plan[bucket][id] ?? { rows: 0, points: 0 };
      const found = actual[bucket]?.[id] ?? { rows: 0, points: 0 };
      if (expected.rows !== found.rows || expected.points !== found.points) {
        mismatches.push(
          `MISMATCH ${label} ${id}: the file has ${expected.rows} rows / ${expected.points} points, ` +
            `the database has ${found.rows} rows / ${found.points} points`,
        );
      }
    }
  }
  return mismatches;
}

const USAGE = `Usage:
  node scripts/import-legacy-tasks.mjs --file <import-set.json> --actor <the Moderator's address> --dry-run
  node scripts/import-legacy-tasks.mjs --file <import-set.json> --actor <the Moderator's address> --execute

Options:
  --batch-size <n>   rows per call, 1-200 (default ${BATCH_SIZE})

Environment:
  SUPABASE_URL         https://<project-ref>.supabase.co (or http://127.0.0.1:54321)
  SUPABASE_SECRET_KEY  the project's secret key

The contract, the checks and the recovery: docs/backend/legacy-task-import.md`;

export async function main(argv, { env, fetchImpl, log, readFile }) {
  let options;
  try {
    ({ values: options } = parseArgs({
      args: argv,
      options: {
        file: { type: "string" },
        actor: { type: "string" },
        "dry-run": { type: "boolean", default: false },
        execute: { type: "boolean", default: false },
        "batch-size": { type: "string" },
        help: { type: "boolean", default: false },
      },
      strict: true,
    }));
  } catch (error) {
    log(`${error.message}\n\n${USAGE}`);
    return 2;
  }
  if (options.help) {
    log(USAGE);
    return 0;
  }
  const dryRun = options["dry-run"];
  if (dryRun === options.execute || !options.file || !options.actor) {
    log(
      `Give --file, --actor and exactly one of --dry-run or --execute.\n\n${USAGE}`,
    );
    return 2;
  }
  const batchSize =
    options["batch-size"] === undefined
      ? BATCH_SIZE
      : Number(options["batch-size"]);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 200) {
    log("--batch-size takes a whole number from 1 to 200.");
    return 2;
  }

  const url = env.SUPABASE_URL ?? "";
  const secretKey = env.SUPABASE_SECRET_KEY ?? "";
  // The secret key travels on every request, so plain http is for the local stack only.
  let parsedUrl = null;
  try {
    parsedUrl = new URL(url);
  } catch {
    parsedUrl = null;
  }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(
    parsedUrl?.hostname ?? "",
  );
  if (
    !parsedUrl ||
    !(
      parsedUrl.protocol === "https:" ||
      (parsedUrl.protocol === "http:" && loopback)
    )
  ) {
    log(
      "SUPABASE_URL must be https (plain http is accepted for the local stack only).",
    );
    return 2;
  }
  if (secretKey === "") {
    log("SUPABASE_SECRET_KEY is not set.");
    return 2;
  }

  let fileRows;
  let commandRows;
  try {
    fileRows = JSON.parse(readFile(options.file));
    if (!Array.isArray(fileRows) || fileRows.length === 0)
      throw new Error("the file holds no rows");
    commandRows = fileRows.map(toCommandRow);
    // The command refuses a repeated key inside one call; two calls would
    // silently import the first and skip the second.
    const seen = new Set();
    for (const row of commandRows) {
      const key = `${row.tracker_id}#${row.sheet_row}`;
      if (seen.has(key)) {
        throw new Error(`${where(row)} appears twice in the file`);
      }
      seen.add(key);
    }
  } catch (error) {
    log(`${options.file} cannot be imported: ${error.message}`);
    return 1;
  }

  const plan = planTotals(fileRows);
  log(
    `${plan.rows} rows, ${plan.points} points, ${Object.keys(plan.members).length} Members, ` +
      `${plan.from} … ${plan.to}`,
  );
  for (const id of Object.keys(plan.groups).sort(
    (a, b) => Number(a) - Number(b),
  )) {
    log(
      `  Group ${id}: ${plan.groups[id].rows} rows, ${plan.groups[id].points} points`,
    );
  }

  const client = createClient({ url, secretKey, fetchImpl });
  let actor;
  try {
    const found = await client.profilesByEmail(
      options.actor.trim().toLowerCase(),
    );
    actor = found.find(
      (profile) => profile.role === "moderator" && profile.status === "activ",
    );
  } catch (error) {
    log(`The acting Member could not be read: ${error.message}`);
    return 1;
  }
  if (!actor) {
    log(
      `${options.actor} is not the active Moderator: only the Moderator runs the Legacy Import.`,
    );
    return 1;
  }

  const batches = [];
  for (let start = 0; start < commandRows.length; start += batchSize) {
    batches.push(commandRows.slice(start, start + batchSize));
  }
  let imported = 0;
  let already = 0;
  for (const [index, batch] of batches.entries()) {
    const first = index * batchSize + 1;
    const label = `Batch ${index + 1}/${batches.length} (rows ${first}–${first + batch.length - 1})`;
    try {
      const result = await client.importBatch(actor.id, batch, dryRun);
      imported += result.imported;
      already += result.already_imported;
      // With nothing skipped, the command scored exactly these rows: its
      // points must be the file's. A difference means the scoring guide in
      // the database is not the one this script (and the import set) assumes.
      const planned = batch.reduce(
        (sum, row) => sum + BASE_POINTS[row.difficulty] * (row.rating - 2),
        0,
      );
      if (result.already_imported === 0 && result.points !== planned) {
        log(
          `${label}: the database scores it at ${result.points} points, the file at ${planned}.`,
        );
        log(
          dryRun
            ? "The scoring guide in the database differs from the import set's. Nothing was written."
            : "The scoring guide in the database differs from the import set's. This batch IS written: stop and see docs/backend/legacy-task-import.md.",
        );
        return 1;
      }
      log(
        `${label}: ${result.imported} imported, ${result.already_imported} already imported`,
      );
    } catch (error) {
      if (error instanceof TimedOutError) {
        log(`${label} timed out (57014). Nothing of this batch was written.`);
        log(
          "Run again with --batch-size 50: rows already imported are skipped.",
        );
      } else if (error instanceof RefusedError) {
        log(
          `${label} was refused: ${error.code} ${error.message}${error.details ? ` — ${error.details}` : ""}`,
        );
        if (!dryRun) {
          log(
            "Batches before it are in. Fix the file and run again: rows already imported are skipped.",
          );
        }
      } else {
        log(
          `${label} got no answer (${error.message}). It may or may not have been written.`,
        );
        log("Run the same command again: rows already imported are skipped.");
      }
      return 1;
    }
  }

  if (dryRun) {
    log(
      `Dry run: ${imported} would be imported, ${already} already imported. Nothing was written.`,
    );
    return 0;
  }

  let actual;
  try {
    actual = await client.totals();
  } catch (error) {
    log(
      `The import ran, but the totals could not be read back: ${error.message}`,
    );
    return 1;
  }
  const mismatches = compareTotals(plan, actual);
  if (mismatches.length > 0) {
    mismatches.forEach((line) => log(line));
    log(
      "The database does not match the file. Do not close the import; see docs/backend/legacy-task-import.md.",
    );
    return 1;
  }
  log(
    `Verified: ${actual.rows} rows and ${actual.points} points are in, matching the file for every Group and Member.`,
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main(process.argv.slice(2), {
    env: process.env,
    fetchImpl: fetch,
    log: (line) => console.log(line),
    readFile: (path) => readFileSync(path, "utf8"),
  });
}
