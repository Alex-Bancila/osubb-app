import { assertEquals } from "@std/assert";
import type {
  InviteMemberInput,
  InviteMemberResult,
} from "../_shared/member-invite.ts";
import type { RecruitCsvReferences } from "../_shared/csv.ts";
import { type CsvImportDeps, handleCsvImport } from "./handler.ts";

interface FakeOptions {
  callerId?: string | null;
  callerError?: Error;
  level?: number;
  memberLevelError?: Error;
  references?: Record<"departments" | "teams", string[]>;
  outcomes?: Record<string, InviteMemberResult>;
  referenceError?: Error;
  throwEmails?: ReadonlySet<string>;
}

function fakeDeps(options: FakeOptions = {}) {
  const invited: InviteMemberInput[] = [];
  const referenceLoads: string[] = [];

  const deps: CsvImportDeps = {
    callerId: () =>
      options.callerError
        ? Promise.reject(options.callerError)
        : Promise.resolve(
          options.callerId === undefined ? "caller-1" : options.callerId,
        ),
    memberLevel: () =>
      options.memberLevelError
        ? Promise.reject(options.memberLevelError)
        : Promise.resolve(options.level ?? 6),
    referenceIds: (table) => {
      referenceLoads.push(table);
      if (options.referenceError) return Promise.reject(options.referenceError);
      return Promise.resolve(
        options.references?.[table] ??
          (table === "departments" ? ["edu", "pr"] : ["t-app"]),
      );
    },
    invite: (input) => {
      invited.push(input);
      if (options.throwEmails?.has(input.email)) {
        return Promise.reject(new Error("private row detail"));
      }
      return Promise.resolve(
        options.outcomes?.[input.email] ?? {
          kind: "created",
          email: input.email,
          userId: `user-${invited.length}`,
        },
      );
    },
  };

  return { deps, invited, referenceLoads };
}

function request(
  body: unknown,
  { auth = true, origin }: { auth?: boolean; origin?: string } = {},
): Request {
  return new Request("http://localhost/csv-import", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: "Bearer token" } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function withAllowedOrigins(
  value: string,
  fn: () => Promise<void>,
): Promise<void> {
  const previous = Deno.env.get("ALLOWED_ORIGINS");
  try {
    Deno.env.set("ALLOWED_ORIGINS", value);
    await fn();
  } finally {
    if (previous === undefined) Deno.env.delete("ALLOWED_ORIGINS");
    else Deno.env.set("ALLOWED_ORIGINS", previous);
  }
}

Deno.test("imports valid rows sequentially and keeps validation failures in the batch result", async () => {
  const { deps, invited, referenceLoads } = fakeDeps({
    outcomes: {
      "existent@example.com": {
        kind: "already_exists",
        email: "existent@example.com",
      },
    },
  });

  const csv = [
    "name,email,dept,team",
    "Ana Pop,ANA@EXAMPLE.COM,edu,",
    "Greșit,bad@example.com,necunoscut,",
    "Existent,existent@example.com,pr,t-app",
  ].join("\n");
  const response = await handleCsvImport(request({ csv }), deps);
  const payload = await response.json();

  assertEquals(response.status, 200);
  assertEquals(referenceLoads, ["departments", "teams"]);
  assertEquals(invited.map((row) => row.email), [
    "ana@example.com",
    "existent@example.com",
  ]);
  assertEquals(invited.every((row) => row.role === "recrut"), true);
  assertEquals(payload, {
    summary: { created: 1, skipped: 1, errors: 1 },
    created: [{ row: 2, email: "ana@example.com", user_id: "user-1" }],
    skipped: [
      {
        row: 4,
        email: "existent@example.com",
        code: "already_exists",
      },
    ],
    errors: [
      {
        row: 3,
        field: "dept",
        code: "unknown_department",
        message: "Departament inexistent: necunoscut.",
      },
    ],
  });
});

Deno.test("passes the once-loaded reference sets into every shared invite", async () => {
  const { deps } = fakeDeps();
  const seen: Array<RecruitCsvReferences | undefined> = [];
  const observingDeps: CsvImportDeps = {
    ...deps,
    invite: async (
      input: InviteMemberInput,
      references?: RecruitCsvReferences,
    ) => {
      seen.push(references);
      return await deps.invite(input, references!);
    },
  };

  await handleCsvImport(
    request({ csv: "name,email,dept,team\nAna,a@example.com,edu,t-app" }),
    observingDeps,
  );

  assertEquals(seen.length, 1);
  assertEquals(
    seen[0]
      ? {
        departmentIds: [...seen[0].departmentIds],
        teamIds: [...seen[0].teamIds],
      }
      : null,
    { departmentIds: ["edu", "pr"], teamIds: ["t-app"] },
  );
});

Deno.test("refuses a request without a bearer token before reading the batch", async () => {
  const { deps, invited, referenceLoads } = fakeDeps();
  const response = await handleCsvImport(
    request({ csv: "name,email,dept,team" }, { auth: false }),
    deps,
  );

  assertEquals(response.status, 401);
  assertEquals(invited, []);
  assertEquals(referenceLoads, []);
});

Deno.test("refuses an invalid session before loading reference data", async () => {
  const { deps, invited, referenceLoads } = fakeDeps({ callerId: null });
  const response = await handleCsvImport(
    request({ csv: "name,email,dept,team" }),
    deps,
  );

  assertEquals(response.status, 401);
  assertEquals(invited, []);
  assertEquals(referenceLoads, []);
});

Deno.test("returns an invalid-session response when authentication lookup fails", async () => {
  const { deps, referenceLoads } = fakeDeps({
    callerError: new Error("private auth detail"),
  });
  const response = await handleCsvImport(
    request({ csv: "name,email,dept,team" }),
    deps,
  ).catch(() => new Response(null, { status: 599 }));
  const payload = await response.json().catch(() => ({}));

  assertEquals(response.status, 401);
  assertEquals(payload, { error: "Sesiune invalidă sau expirată." });
  assertEquals(referenceLoads, []);
});

Deno.test("authorizes from the current database level and refuses level 5", async () => {
  const { deps, invited, referenceLoads } = fakeDeps({ level: 5 });
  const response = await handleCsvImport(
    request({ csv: "name,email,dept,team" }),
    deps,
  );

  assertEquals(response.status, 403);
  assertEquals(invited, []);
  assertEquals(referenceLoads, []);
});

Deno.test("refuses an inactive caller whose authoritative level is zero", async () => {
  const { deps, invited } = fakeDeps({ level: 0 });
  const response = await handleCsvImport(
    request({ csv: "name,email,dept,team" }),
    deps,
  );

  assertEquals(response.status, 403);
  assertEquals(invited, []);
});

Deno.test("does not expose an authorization lookup failure", async () => {
  const { deps } = fakeDeps({
    memberLevelError: new Error("private authorization detail"),
  });
  const response = await handleCsvImport(
    request({ csv: "name,email,dept,team" }),
    deps,
  ).catch(() => new Response(null, { status: 599 }));
  const payload = await response.json().catch(() => ({}));

  assertEquals(response.status, 500);
  assertEquals(payload, { error: "Nu am putut verifica permisiunile." });
});

Deno.test("accepts only POST requests", async () => {
  const { deps } = fakeDeps();
  const response = await handleCsvImport(
    new Request("http://localhost/csv-import", { method: "GET" }),
    deps,
  );

  assertEquals(response.status, 405);
});

Deno.test("requires a JSON content type", async () => {
  const { deps } = fakeDeps();
  const response = await handleCsvImport(
    new Request("http://localhost/csv-import", {
      method: "POST",
      headers: {
        Authorization: "Bearer token",
        "Content-Type": "text/plain",
      },
      body: JSON.stringify({ csv: "name,email,dept,team" }),
    }),
    deps,
  );

  assertEquals(response.status, 415);
});

Deno.test("requires the JSON body to contain CSV text", async () => {
  const { deps, referenceLoads } = fakeDeps();
  const response = await handleCsvImport(request({ csv: 42 }), deps);

  assertEquals(response.status, 400);
  assertEquals(referenceLoads, []);
});

Deno.test("answers an allowed browser preflight with the shared CORS policy", async () => {
  await withAllowedOrigins("https://app.osubb.ro", async () => {
    const { deps } = fakeDeps();
    const response = await handleCsvImport(
      new Request("http://localhost/csv-import", {
        method: "OPTIONS",
        headers: { Origin: "https://app.osubb.ro" },
      }),
      deps,
    );

    assertEquals(response.status, 200);
    assertEquals(
      response.headers.get("Access-Control-Allow-Origin"),
      "https://app.osubb.ro",
    );
    assertEquals(response.headers.get("Vary"), "Origin");
  });
});

Deno.test("refuses preflight from an origin outside the shared allow-list", async () => {
  await withAllowedOrigins("https://app.osubb.ro", async () => {
    const { deps } = fakeDeps();
    const response = await handleCsvImport(
      new Request("http://localhost/csv-import", {
        method: "OPTIONS",
        headers: { Origin: "https://evil.example" },
      }),
      deps,
    );

    assertEquals(response.status, 403);
    assertEquals(response.headers.has("Access-Control-Allow-Origin"), false);
  });
});

Deno.test("returns a client error instead of throwing for malformed JSON", async () => {
  const { deps } = fakeDeps();
  const status = await handleCsvImport(request("{not json"), deps)
    .then((response) => response.status)
    .catch(() => 0);

  assertEquals(status, 400);
});

Deno.test("returns a client error for a JSON null body", async () => {
  const { deps } = fakeDeps();
  const response = await handleCsvImport(request(null), deps)
    .catch(() => new Response(null, { status: 599 }));

  assertEquals(response.status, 400);
});

Deno.test("rejects CSV content larger than 256 KiB before loading references", async () => {
  const { deps, invited, referenceLoads } = fakeDeps();
  const csv = `name,email,dept,team\n${"A".repeat(256 * 1024)},a@example.com,,`;
  const response = await handleCsvImport(request({ csv }), deps);

  assertEquals(response.status, 413);
  assertEquals(invited, []);
  assertEquals(referenceLoads, []);
});

Deno.test("rejects more than 100 nonblank data records before inviting anyone", async () => {
  const { deps, invited } = fakeDeps();
  const rows = Array.from(
    { length: 101 },
    (_, index) => `Membru ${index},member${index}@example.com,,`,
  );
  const response = await handleCsvImport(
    request({ csv: ["name,email,dept,team", ...rows].join("\n") }),
    deps,
  );

  assertEquals(response.status, 413);
  assertEquals(invited, []);
});

Deno.test("accepts exactly 100 data records", async () => {
  const { deps, invited } = fakeDeps();
  const rows = Array.from(
    { length: 100 },
    (_, index) => `Membru ${index},member${index}@example.com,,`,
  );
  const response = await handleCsvImport(
    request({ csv: ["name,email,dept,team", ...rows].join("\n") }),
    deps,
  );
  const payload = await response.json();

  assertEquals(response.status, 200);
  assertEquals(invited.length, 100);
  assertEquals(payload.summary, { created: 100, skipped: 0, errors: 0 });
});

Deno.test("returns a file-level error for an invalid CSV header", async () => {
  const { deps, invited } = fakeDeps();
  const status = await handleCsvImport(
    request({ csv: "email,name,dept,team\na@example.com,Ana,," }),
    deps,
  ).then((response) => response.status).catch(() => 0);

  assertEquals(status, 400);
  assertEquals(invited, []);
});

Deno.test("stops the whole import safely when reference data cannot load", async () => {
  const { deps, invited } = fakeDeps({
    referenceError: new Error("database details must stay private"),
  });
  const response = await handleCsvImport(
    request({ csv: "name,email,dept,team\nAna,a@example.com,," }),
    deps,
  ).catch(() => new Response(null, { status: 599 }));
  const payload = await response.json().catch(() => ({}));

  assertEquals(response.status, 500);
  assertEquals(payload, {
    error: "Nu am putut încărca departamentele și echipele.",
  });
  assertEquals(invited, []);
});

Deno.test("skips repeated emails later in the same file without inviting twice", async () => {
  const { deps, invited } = fakeDeps();
  const response = await handleCsvImport(
    request({
      csv: [
        "name,email,dept,team",
        "Ana,ANA@example.com,edu,",
        "Ana din nou,ana@example.com,edu,",
      ].join("\n"),
    }),
    deps,
  );
  const payload = await response.json();

  assertEquals(response.status, 200);
  assertEquals(invited.map((row) => row.email), ["ana@example.com"]);
  assertEquals(payload.summary, { created: 1, skipped: 1, errors: 0 });
  assertEquals(payload.skipped, [{
    row: 3,
    email: "ana@example.com",
    code: "duplicate_in_file",
  }]);
});

Deno.test("records an invite-provider failure and continues with later rows", async () => {
  const { deps, invited } = fakeDeps({
    outcomes: {
      "fail@example.com": {
        kind: "invite_failed",
        cause: { message: "private provider detail", status: 503 },
      },
    },
  });
  const response = await handleCsvImport(
    request({
      csv: [
        "name,email,dept,team",
        "Eșec,fail@example.com,edu,",
        "Reușită,ok@example.com,edu,",
      ].join("\n"),
    }),
    deps,
  );
  const payload = await response.json();

  assertEquals(response.status, 200);
  assertEquals(invited.map((row) => row.email), [
    "fail@example.com",
    "ok@example.com",
  ]);
  assertEquals(payload.summary, { created: 1, skipped: 0, errors: 1 });
  assertEquals(payload.errors, [{
    row: 2,
    email: "fail@example.com",
    field: "row",
    code: "invite_failed",
    message: "Trimiterea invitației a eșuat.",
  }]);
  assertEquals(
    JSON.stringify(payload).includes("private provider detail"),
    false,
  );
});

Deno.test("records a compensated provisioning failure without exposing database details", async () => {
  const { deps } = fakeDeps({
    outcomes: {
      "fail@example.com": {
        kind: "provision_failed",
        details: "violates private_database_constraint",
        cause: { code: "23503", message: "private_database_constraint" },
      },
    },
  });
  const response = await handleCsvImport(
    request({
      csv: "name,email,dept,team\nEșec,fail@example.com,edu,",
    }),
    deps,
  );
  const payload = await response.json();

  assertEquals(payload.summary, { created: 0, skipped: 0, errors: 1 });
  assertEquals(payload.errors, [{
    row: 2,
    email: "fail@example.com",
    field: "row",
    code: "provision_failed",
    message: "Crearea profilului a eșuat.",
  }]);
  assertEquals(
    JSON.stringify(payload).includes("private_database_constraint"),
    false,
  );
});

Deno.test("records a reference removed after parsing as a row failure", async () => {
  const { deps } = fakeDeps({
    outcomes: {
      "race@example.com": {
        kind: "invalid_reference",
        message: "Departament inexistent: edu.",
      },
    },
  });
  const response = await handleCsvImport(
    request({ csv: "name,email,dept,team\nAna,race@example.com,edu," }),
    deps,
  );
  const payload = await response.json();

  assertEquals(payload.errors, [{
    row: 2,
    email: "race@example.com",
    field: "row",
    code: "invalid_reference",
    message: "Departament inexistent: edu.",
  }]);
});

Deno.test("contains an unexpected row failure and continues the batch", async () => {
  const { deps, invited } = fakeDeps({
    throwEmails: new Set(["fail@example.com"]),
  });
  const response = await handleCsvImport(
    request({
      csv: [
        "name,email,dept,team",
        "Eșec,fail@example.com,,",
        "Reușită,ok@example.com,,",
      ].join("\n"),
    }),
    deps,
  ).catch(() => new Response(null, { status: 599 }));
  const payload = await response.json().catch(() => ({}));

  assertEquals(response.status, 200);
  assertEquals(invited.map((row) => row.email), [
    "fail@example.com",
    "ok@example.com",
  ]);
  assertEquals(payload.summary, { created: 1, skipped: 0, errors: 1 });
  assertEquals(payload.errors, [{
    row: 2,
    email: "fail@example.com",
    field: "row",
    code: "unexpected_error",
    message: "Importul acestui rând a eșuat.",
  }]);
});
