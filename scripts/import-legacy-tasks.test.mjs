// node:test suite for scripts/import-legacy-tasks.mjs (#1049). Every call goes
// to an in-memory fake of PostgREST; no test touches a network or a database.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BASE_POINTS,
  main,
  parseSheetDate,
  planTotals,
  toCommandRow,
} from "./import-legacy-tasks.mjs";

const MODERATOR = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "mod@example.com",
  role: "moderator",
  status: "activ",
};
const BC = {
  id: "00000000-0000-4000-8000-000000000002",
  email: "bc@example.com",
  role: "bc",
  status: "activ",
};

function fileRow(n, overrides = {}) {
  return {
    tracker_id: "trackerFileIdForTests0001",
    sheet_row: n + 1,
    sheet_id: `1-1-${n}`,
    group_id: 4,
    group: "Resurse Umane",
    profile_id: `00000000-0000-4000-8000-${String(100 + (n % 3)).padStart(12, "0")}`,
    title: "Ședință",
    full_title: null,
    deadline: "3/12/2026",
    difficulty_level: 2,
    rating: 3,
    sheet_status: "Realizat",
    completed_on: "2026-03-10",
    observations: "",
    ...overrides,
  };
}

/** An in-memory project: profiles, the registry the command keeps, and switches for the failures. */
function fakeProject({
  profiles = [MODERATOR, BC],
  refuseAtCall = null,
  dropAtCall = null,
  tamperTotals = false,
} = {}) {
  const registry = new Map();
  const calls = [];
  const json = (status, body) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  const fetchImpl = async (url, init = {}) => {
    const { pathname, searchParams } = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    assert.equal(
      init.headers.apikey,
      "sb_secret_test",
      "every request carries the secret key",
    );
    if (pathname === "/rest/v1/profiles") {
      const email = (searchParams.get("email") ?? "").replace(/^eq\./, "");
      return json(
        200,
        profiles.filter((profile) => profile.email === email),
      );
    }
    if (pathname === "/rest/v1/rpc/import_legacy_tasks") {
      calls.push(body);
      if (dropAtCall === calls.length) throw new TypeError("fetch failed");
      if (refuseAtCall === calls.length) {
        return json(400, {
          code: "PT400",
          message: "invalid_executor",
          details: "row 2 (trackerFileIdForTests0001, sheet row 3)",
        });
      }
      let imported = 0;
      let already = 0;
      let points = 0;
      for (const row of body.p_rows) {
        const key = `${row.tracker_id}#${row.sheet_row}`;
        if (registry.has(key)) {
          already += 1;
          continue;
        }
        imported += 1;
        points += BASE_POINTS[row.difficulty] * (row.rating - 2);
        if (!body.p_dry_run) registry.set(key, row);
      }
      return json(200, {
        received: body.p_rows.length,
        imported,
        already_imported: already,
        points,
        dry_run: body.p_dry_run,
      });
    }
    if (pathname === "/rest/v1/rpc/legacy_task_import_totals") {
      const totals = { rows: 0, points: 0, groups: {}, members: {} };
      for (const row of registry.values()) {
        const points = BASE_POINTS[row.difficulty] * (row.rating - 2);
        totals.rows += 1;
        totals.points += points;
        for (const [bucket, id] of [
          ["groups", String(row.group_id)],
          ["members", row.executor_id],
        ]) {
          totals[bucket][id] ??= { rows: 0, points: 0 };
          totals[bucket][id].rows += 1;
          totals[bucket][id].points += points;
        }
      }
      if (tamperTotals) totals.points += 1;
      return json(200, totals);
    }
    return json(404, { message: `unexpected ${pathname}` });
  };
  return { fetchImpl, calls, registry };
}

async function run(args, project, rows) {
  const lines = [];
  const code = await main(args, {
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SECRET_KEY: "sb_secret_test",
    },
    fetchImpl: project.fetchImpl,
    log: (line) => lines.push(line),
    readFile: () => JSON.stringify(rows),
  });
  return { code, output: lines.join("\n") };
}

const rows250 = Array.from({ length: 250 }, (_, index) => fileRow(index + 1));

test("a sheet date is read in the two shapes the sheets hold, and nothing else", () => {
  assert.equal(parseSheetDate("3/12/2026"), "2026-03-12");
  assert.equal(parseSheetDate("12/25/2025"), "2025-12-25");
  assert.equal(parseSheetDate("6.12.2025"), "2025-12-06");
  assert.equal(parseSheetDate("09.02.2026"), "2026-02-09");
  assert.equal(parseSheetDate(""), null);
  assert.equal(parseSheetDate(null), null);
  assert.throws(
    () => parseSheetDate("12-03-2026"),
    /unreadable date "12-03-2026"/,
  );
  assert.throws(
    () => parseSheetDate("2/30/2026"),
    /unreadable date "2\/30\/2026"/,
  );
});

test("a file row becomes a command row", () => {
  assert.deepEqual(
    toCommandRow(
      fileRow(1, { observations: " urgent ", full_title: "Titlul întreg" }),
    ),
    {
      tracker_id: "trackerFileIdForTests0001",
      sheet_row: 2,
      sheet_id: "1-1-1",
      group_id: 4,
      executor_id: "00000000-0000-4000-8000-000000000101",
      title: "Ședință",
      description: "Titlul întreg",
      difficulty: 2,
      rating: 3,
      outcome: "completed",
      completed_on: "2026-03-10",
      deadline_on: "2026-03-12",
      note: "urgent",
    },
  );
  const unfulfilled = toCommandRow(
    fileRow(2, { sheet_status: "Nerealizat", deadline: "", observations: "" }),
  );
  assert.equal(unfulfilled.outcome, "unfulfilled");
  assert.equal(unfulfilled.deadline_on, null);
  assert.equal(unfulfilled.note, "Importat din Task Tracker.");
  assert.equal(
    toCommandRow(fileRow(3, { sheet_status: "(blank)" })).outcome,
    "completed",
  );
});

test("a row whose Group is still pending, or whose date cannot be read, stops the file before any call", async () => {
  const project = fakeProject();
  const pending = await run(
    ["--file", "f.json", "--actor", "mod@example.com", "--dry-run"],
    project,
    [
      fileRow(1),
      fileRow(2, { group_id: "PENDING", group: "Mind Matters 2025" }),
    ],
  );
  assert.equal(pending.code, 1);
  assert.match(
    pending.output,
    /trackerFileIdForTests0001 row 3: its Group is not set \(Mind Matters 2025\)/,
  );
  const badDate = await run(
    ["--file", "f.json", "--actor", "mod@example.com", "--dry-run"],
    project,
    [fileRow(1, { deadline: "12-03-2026" })],
  );
  assert.equal(badDate.code, 1);
  assert.match(
    badDate.output,
    /trackerFileIdForTests0001 row 2: unreadable date "12-03-2026"/,
  );
  assert.equal(project.calls.length, 0, "no call was made");
});

test("the plan totals are the file totals", () => {
  const totals = planTotals([
    fileRow(1),
    fileRow(2, { difficulty_level: 10, rating: 5, group_id: 5 }),
  ]);
  assert.equal(totals.rows, 2);
  assert.equal(totals.points, 2 + 60);
  assert.deepEqual(totals.groups, {
    4: { rows: 1, points: 2 },
    5: { rows: 1, points: 60 },
  });
  assert.equal(totals.from, "2026-03-10");
});

test("a dry run sends every batch as a dry run, prints the plan and writes nothing", async () => {
  const project = fakeProject();
  const { code, output } = await run(
    ["--file", "f.json", "--actor", "mod@example.com", "--dry-run"],
    project,
    rows250,
  );
  assert.equal(code, 0);
  assert.deepEqual(
    project.calls.map((call) => [
      call.p_rows.length,
      call.p_dry_run,
      call.p_actor,
    ]),
    [
      [100, true, MODERATOR.id],
      [100, true, MODERATOR.id],
      [50, true, MODERATOR.id],
    ],
  );
  assert.equal(project.registry.size, 0);
  assert.match(
    output,
    /250 rows, 500 points, 3 Members, 2026-03-10 … 2026-03-10/,
  );
  assert.match(output, /Group 4: 250 rows, 500 points/);
  assert.match(
    output,
    /Dry run: 250 would be imported, 0 already imported\. Nothing was written\./,
  );
});

test("the real run imports in batches and verifies the totals it reads back", async () => {
  const project = fakeProject();
  const { code, output } = await run(
    ["--file", "f.json", "--actor", "mod@example.com", "--execute"],
    project,
    rows250,
  );
  assert.equal(code, 0);
  assert.equal(project.registry.size, 250);
  assert.match(
    output,
    /Batch 3\/3 \(rows 201–250\): 50 imported, 0 already imported/,
  );
  assert.match(
    output,
    /Verified: 250 rows and 500 points are in, matching the file for every Group and Member\./,
  );
});

test("--batch-size changes the batch", async () => {
  const project = fakeProject();
  const { code } = await run(
    [
      "--file",
      "f.json",
      "--actor",
      "mod@example.com",
      "--execute",
      "--batch-size",
      "200",
    ],
    project,
    rows250,
  );
  assert.equal(code, 0);
  assert.deepEqual(
    project.calls.map((call) => call.p_rows.length),
    [200, 50],
  );
});

test("a refusal stops the run at that batch and names the row", async () => {
  const project = fakeProject({ refuseAtCall: 2 });
  const { code, output } = await run(
    ["--file", "f.json", "--actor", "mod@example.com", "--execute"],
    project,
    rows250,
  );
  assert.equal(code, 1);
  assert.equal(project.calls.length, 2, "the third batch was never sent");
  assert.match(
    output,
    /Batch 2\/3 \(rows 101–200\) was refused: PT400 invalid_executor — row 2 \(trackerFileIdForTests0001, sheet row 3\)/,
  );
  assert.match(
    output,
    /Batches before it are in\. Fix the file and run again: rows already imported are skipped\./,
  );
});

test("a call that gets no answer is reported as such, and the next run completes the import", async () => {
  const dropped = fakeProject({ dropAtCall: 2 });
  const first = await run(
    ["--file", "f.json", "--actor", "mod@example.com", "--execute"],
    dropped,
    rows250,
  );
  assert.equal(first.code, 1);
  assert.match(
    first.output,
    /Batch 2\/3 \(rows 101–200\) got no answer \(fetch failed\)\. It may or may not have been written\./,
  );

  const resumed = fakeProject();
  for (const row of rows250.slice(0, 100))
    resumed.registry.set(
      `${row.tracker_id}#${row.sheet_row}`,
      toCommandRow(row),
    );
  const second = await run(
    ["--file", "f.json", "--actor", "mod@example.com", "--execute"],
    resumed,
    rows250,
  );
  assert.equal(second.code, 0);
  assert.match(
    second.output,
    /Batch 1\/3 \(rows 1–100\): 0 imported, 100 already imported/,
  );
  assert.equal(resumed.registry.size, 250);
});

test("totals that differ from the file fail the run", async () => {
  const project = fakeProject({ tamperTotals: true });
  const { code, output } = await run(
    ["--file", "f.json", "--actor", "mod@example.com", "--execute"],
    project,
    rows250,
  );
  assert.equal(code, 1);
  assert.match(
    output,
    /MISMATCH points: the file has 500, the database has 501/,
  );
});

test("only the Moderator may be the acting Member, checked before any call", async () => {
  const project = fakeProject();
  const bc = await run(
    ["--file", "f.json", "--actor", "bc@example.com", "--execute"],
    project,
    rows250,
  );
  assert.equal(bc.code, 1);
  assert.match(bc.output, /bc@example\.com is not the active Moderator/);
  const nobody = await run(
    ["--file", "f.json", "--actor", "who@example.com", "--execute"],
    project,
    rows250,
  );
  assert.equal(nobody.code, 1);
  assert.equal(project.calls.length, 0);
});

test("usage errors answer 2 and make no call", async () => {
  const project = fakeProject();
  assert.equal(
    (
      await run(
        ["--file", "f.json", "--actor", "mod@example.com"],
        project,
        rows250,
      )
    ).code,
    2,
  );
  assert.equal(
    (
      await run(
        [
          "--file",
          "f.json",
          "--actor",
          "mod@example.com",
          "--dry-run",
          "--execute",
        ],
        project,
        rows250,
      )
    ).code,
    2,
  );
  assert.equal(
    (await run(["--actor", "mod@example.com", "--dry-run"], project, rows250))
      .code,
    2,
  );
  assert.equal(
    (
      await run(
        [
          "--file",
          "f.json",
          "--actor",
          "mod@example.com",
          "--dry-run",
          "--batch-size",
          "201",
        ],
        project,
        rows250,
      )
    ).code,
    2,
  );
  assert.equal(project.calls.length, 0);
});

test("a plain-http URL is accepted for the local stack only", async () => {
  const project = fakeProject();
  const lines = [];
  const code = await main(
    ["--file", "f.json", "--actor", "mod@example.com", "--dry-run"],
    {
      env: {
        SUPABASE_URL: "http://example.com",
        SUPABASE_SECRET_KEY: "sb_secret_test",
      },
      fetchImpl: project.fetchImpl,
      log: (line) => lines.push(line),
      readFile: () => JSON.stringify(rows250),
    },
  );
  assert.equal(code, 2);
  assert.match(lines.join("\n"), /SUPABASE_URL must be https/);
});
