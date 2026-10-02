// #991: csv-import's volunteer-sheet format -- dry-run and apply. Invented
// rows only; the real sheet never enters the repository.
import { assertEquals } from "@std/assert";
import type { KnownAddress } from "../_shared/volunteer-sheet.ts";
import { context, GROUPS, sheet } from "../_shared/volunteer-sheet.fixtures.ts";
import { type CsvImportDeps, handleCsvImport } from "./handler.ts";
import type {
  AuthError,
  ImportMemberArgs,
  ImportMemberResult,
  VolunteerImportDeps,
} from "./volunteers.ts";
import type { DbError } from "../_shared/member-invite.ts";

interface FakeOptions {
  level?: number;
  known?: Record<string, KnownAddress>;
  /** What every lookup after the first answers (a race, a cleanup check). */
  knownAfterDuplicate?: Record<string, KnownAddress>;
  createErrors?: Record<string, AuthError>;
  importErrors?: Record<string, DbError>;
}

function fakeDeps(options: FakeOptions = {}) {
  const calls: string[] = [];
  const imported: ImportMemberArgs[] = [];
  let lookups = 0;
  const volunteers: VolunteerImportDeps = {
    importGroups: () => Promise.resolve(GROUPS),
    boardGroupId: () => Promise.resolve(63),
    lookupAddresses: () => {
      lookups += 1;
      const source = lookups > 1 && options.knownAfterDuplicate
        ? options.knownAfterDuplicate
        : options.known ?? {};
      return Promise.resolve(new Map(Object.entries(source)));
    },
    createAccount: (email) => {
      calls.push(`create:${email}`);
      const error = options.createErrors?.[email];
      return Promise.resolve(error ? { error } : { userId: `user-${email}` });
    },
    importMember: (args) => {
      calls.push(`import:${args.email}:${args.userId}`);
      imported.push(args);
      const error = options.importErrors?.[args.email];
      if (error) return Promise.resolve({ error });
      const result: ImportMemberResult = {
        member_id: args.userId,
        outcome: args.userId.startsWith("user-") || args.userId === "orphan"
          ? "created"
          : "completed",
        placements: args.placements.map((p) => ({ ...p, status: "appointed" })),
      };
      return Promise.resolve({ result });
    },
    deleteUser: (userId) => {
      calls.push(`delete:${userId}`);
      return Promise.resolve();
    },
  };
  const deps: CsvImportDeps = {
    callerId: () => Promise.resolve("caller-1"),
    memberLevel: () => Promise.resolve(options.level ?? 6),
    activeGroups: () => Promise.reject(new Error("recruits path")),
    invite: () => Promise.reject(new Error("recruits path")),
    volunteers,
  };
  return { deps, calls, imported };
}

function request(body: unknown): Request {
  return new Request("http://localhost/csv-import", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer token",
    },
    body: JSON.stringify(body),
  });
}

const CSV = sheet(
  "Pop Ana,Membru voluntar,ana@x.ro,712345678,Tineret,Imagine&PR,,,,01.01.2000,UBB,FSEGA,X,Licență,2",
  'Mara Ene,"BCE, Coordonator FR",mara@x.ro,,Financiar,,,,,,,,,,',
  "Fara Email,Membru voluntar,,,,,,,,,,,,,",
  'Ion Dan,"BC, Președinte",dan@x.ro,,,,,,,,,,,,',
);

Deno.test("the volunteer sheet is refused below level 6, like every import", async () => {
  const { deps, calls } = fakeDeps({ level: 5 });
  const res = await handleCsvImport(request({ csv: CSV }), deps);
  assertEquals(res.status, 403);
  assertEquals(calls, []);
});

Deno.test("dry-run (the default) answers the plan and the problems and writes nothing", async () => {
  const { deps, calls } = fakeDeps();
  const res = await handleCsvImport(request({ csv: CSV }), deps);
  const payload = await res.json();
  assertEquals(res.status, 200);
  assertEquals(calls, []);
  assertEquals(payload.format, "volunteers");
  assertEquals(payload.mode, "dry_run");
  assertEquals(payload.summary, {
    rows: 4,
    create: 3,
    complete: 0,
    skip: 1,
    with_warnings: 0,
  });
  assertEquals(payload.rows[0], {
    row: 2,
    full_name: "Pop Ana",
    email: "ana@x.ro",
    phone: "+40712345678",
    rank: "voluntar",
    function: "Membru voluntar",
    action: "create",
    member_id: null,
    placements: [
      {
        group_id: 2,
        group_name: "Tineret",
        group_role: "member",
        position_title: null,
      },
      {
        group_id: 1,
        group_name: "Imagine & PR",
        group_role: "member",
        position_title: null,
      },
    ],
    problems: [],
  });
  assertEquals(payload.rows[2].problems, [
    { code: "email_required", message: "Emailul lipsește.", blocking: true },
  ]);
  // The internal orphan id never reaches the browser.
  assertEquals("orphanUserId" in payload.rows[0], false);
});

Deno.test("apply creates each account without mail, then imports it, and skips blocked rows", async () => {
  const { deps, calls, imported } = fakeDeps();
  const res = await handleCsvImport(request({ csv: CSV, mode: "apply" }), deps);
  const payload = await res.json();
  assertEquals(res.status, 200);
  assertEquals(calls, [
    "create:ana@x.ro",
    "import:ana@x.ro:user-ana@x.ro",
    "create:mara@x.ro",
    "import:mara@x.ro:user-mara@x.ro",
    "create:dan@x.ro",
    "import:dan@x.ro:user-dan@x.ro",
  ]);
  assertEquals(payload.summary, {
    created: 3,
    completed: 0,
    skipped: 1,
    failed: 0,
  });
  assertEquals(payload.rows[2].outcome, "skipped");
  assertEquals(payload.rows[2].code, "email_required");
  assertEquals(imported[0], {
    userId: "user-ana@x.ro",
    fullName: "Pop Ana",
    email: "ana@x.ro",
    rank: "voluntar",
    phone: "+40712345678",
    joinedAt: "2026-02-22",
    placements: [
      { group_id: 2, group_role: "member", position_title: null },
      { group_id: 1, group_role: "member", position_title: null },
    ],
    problems: [],
    sheetRow: 2,
    importedBy: "caller-1",
  });
  assertEquals(imported[1].placements, [
    { group_id: 3, group_role: "manager", position_title: "Coordonator FR" },
  ]);
  assertEquals(imported[2].rank, "bc");
  assertEquals(imported[2].placements, [
    { group_id: 63, group_role: "responsible", position_title: "Președinte" },
  ]);
});

Deno.test("apply only the rows asked for; an unknown row number is reported", async () => {
  const { deps, calls } = fakeDeps();
  const payload = await (await handleCsvImport(
    request({ csv: CSV, mode: "apply", rows: [3, 99] }),
    deps,
  )).json();
  assertEquals(calls, ["create:mara@x.ro", "import:mara@x.ro:user-mara@x.ro"]);
  assertEquals(
    payload.rows.map((
      r: { row: number; outcome: string; code?: string },
    ) => [r.row, r.outcome, r.code]),
    [[3, "created", undefined], [99, "skipped", "row_not_found"]],
  );
});

Deno.test("a re-run completes an imported Member and never creates a second account", async () => {
  const { deps, calls } = fakeDeps({
    known: {
      "ana@x.ro": {
        memberId: "member-ana",
        imported: true,
        orphanUserId: null,
      },
    },
  });
  const payload = await (await handleCsvImport(
    request({ csv: CSV, mode: "apply", rows: [2] }),
    deps,
  )).json();
  assertEquals(calls, ["import:ana@x.ro:member-ana"]);
  assertEquals(payload.rows[0].outcome, "completed");
});

Deno.test("an existing Member who was not imported is skipped", async () => {
  const { deps, calls } = fakeDeps({
    known: {
      "ana@x.ro": {
        memberId: "member-ana",
        imported: false,
        orphanUserId: null,
      },
    },
  });
  const payload = await (await handleCsvImport(
    request({ csv: CSV, mode: "apply", rows: [2] }),
    deps,
  )).json();
  assertEquals(calls, []);
  assertEquals([payload.rows[0].outcome, payload.rows[0].code], [
    "skipped",
    "already_member",
  ]);
});

Deno.test("an orphan account from an interrupted run is reused, not created again", async () => {
  const { deps, calls } = fakeDeps({
    known: {
      "ana@x.ro": { memberId: null, imported: false, orphanUserId: "orphan" },
    },
  });
  await handleCsvImport(request({ csv: CSV, mode: "apply", rows: [2] }), deps);
  assertEquals(calls, ["import:ana@x.ro:orphan"]);
});

Deno.test("a create that races another call reuses the account it finds", async () => {
  const { deps, calls } = fakeDeps({
    createErrors: {
      "ana@x.ro": { message: "User already registered", status: 422 },
    },
    knownAfterDuplicate: {
      "ana@x.ro": { memberId: null, imported: false, orphanUserId: "orphan" },
    },
  });
  const payload = await (await handleCsvImport(
    request({ csv: CSV, mode: "apply", rows: [2] }),
    deps,
  )).json();
  assertEquals(calls, ["create:ana@x.ro", "import:ana@x.ro:orphan"]);
  assertEquals(payload.rows[0].outcome, "created");
});

Deno.test("a refused row deletes the account it created (no mail ever left) and reports the reason", async () => {
  const { deps, calls } = fakeDeps({
    importErrors: { "ana@x.ro": { code: "PT409", message: "group_archived" } },
    // The cleanup check: still an orphan, so it is ours to delete.
    knownAfterDuplicate: {
      "ana@x.ro": {
        memberId: null,
        imported: false,
        orphanUserId: "user-ana@x.ro",
      },
    },
  });
  const payload = await (await handleCsvImport(
    request({ csv: CSV, mode: "apply", rows: [2] }),
    deps,
  )).json();
  assertEquals(calls, [
    "create:ana@x.ro",
    "import:ana@x.ro:user-ana@x.ro",
    "delete:user-ana@x.ro",
  ]);
  assertEquals(payload.rows[0], {
    row: 2,
    email: "ana@x.ro",
    outcome: "failed",
    code: "group_archived",
    message: "Un grup ales este arhivat.",
    problems: [],
  });
});

Deno.test("an account another call imported meanwhile is never deleted by this row's failure", async () => {
  const { deps, calls } = fakeDeps({
    importErrors: { "ana@x.ro": { code: "23505", message: "duplicate key" } },
    knownAfterDuplicate: {
      "ana@x.ro": {
        memberId: "user-ana@x.ro",
        imported: true,
        orphanUserId: null,
      },
    },
  });
  const payload = await (await handleCsvImport(
    request({ csv: CSV, mode: "apply", rows: [2] }),
    deps,
  )).json();
  assertEquals(calls, ["create:ana@x.ro", "import:ana@x.ro:user-ana@x.ro"]);
  assertEquals(payload.rows[0].code, "already_exists");
});

Deno.test("a reused account is never deleted when its row fails", async () => {
  const { deps, calls } = fakeDeps({
    known: {
      "ana@x.ro": { memberId: null, imported: false, orphanUserId: "orphan" },
    },
    importErrors: {
      "ana@x.ro": {
        code: "23514",
        message: 'new row violates check constraint "x"',
      },
    },
  });
  const payload = await (await handleCsvImport(
    request({ csv: CSV, mode: "apply", rows: [2] }),
    deps,
  )).json();
  assertEquals(calls, ["import:ana@x.ro:orphan"]);
  // Database prose never leaves the function (L4).
  assertEquals(payload.rows[0].code, "import_failed");
});

Deno.test("apply takes at most 100 rows per call", async () => {
  const many = sheet(
    ...Array.from(
      { length: 101 },
      (_, n) => `Nume ${n},Membru voluntar,v${n}@x.ro,,,,,,,,,,,,`,
    ),
  );
  const { deps, calls } = fakeDeps();
  const all = await handleCsvImport(
    request({ csv: many, mode: "apply" }),
    deps,
  );
  assertEquals([all.status, (await all.json()).code], [413, "too_many_rows"]);
  const rows = Array.from({ length: 101 }, (_, n) => n + 2);
  const listed = await handleCsvImport(
    request({ csv: many, mode: "apply", rows }),
    deps,
  );
  assertEquals([listed.status, (await listed.json()).code], [
    413,
    "too_many_rows",
  ]);
  assertEquals(calls, []);
  // A dry-run of the same file is fine.
  const dry = await handleCsvImport(request({ csv: many }), deps);
  assertEquals(dry.status, 200);
});

Deno.test("an unknown mode or a malformed rows list is refused", async () => {
  const { deps } = fakeDeps();
  const mode = await handleCsvImport(request({ csv: CSV, mode: "go" }), deps);
  assertEquals((await mode.json()).code, "invalid_mode");
  const rows = await handleCsvImport(
    request({ csv: CSV, mode: "apply", rows: ["2"] }),
    deps,
  );
  assertEquals((await rows.json()).code, "invalid_rows");
});

// Keeps the shared fixture honest: the board Group the tests rely on exists.
Deno.test("fixture: the board Group is in the reference set", () => {
  assertEquals(context().boardGroupId, 63);
});
