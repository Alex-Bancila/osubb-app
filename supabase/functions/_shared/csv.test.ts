import { assertEquals, assertThrows } from "@std/assert";
import { parseRecruitsCsv, ParseRecruitsCsvError } from "./csv.ts";
import { buildGroupLookup, type GroupReference } from "./groups.ts";

// A miniature Group tree with the two shapes that make resolution interesting:
// a Team name repeated under two Departments, and a Team that is under no
// Department at all.
const groups: GroupReference[] = [
  { id: 1, name: "Educațional", short: "EDU", path: [1] },
  { id: 2, name: "Imagine & PR", short: "PR", path: [2] },
  { id: 3, name: "Echipa App", short: "APP", path: [1, 3] },
  { id: 4, name: "Echipa App", short: null, path: [2, 4] },
  { id: 5, name: "Interne", short: null, path: [5] },
];
const references = buildGroupLookup(groups);

Deno.test("a valid recruit row resolves both columns to Groups", () => {
  const result = parseRecruitsCsv(
    "name,email,dept,team\n  Ana Pop  ,  ANA@EXAMPLE.COM  ,edu,APP\n",
    references,
  );

  assertEquals(result, {
    valid: [
      {
        row: 2,
        fullName: "Ana Pop",
        email: "ana@example.com",
        groupIds: [1, 3],
      },
    ],
    errors: [],
  });
});

Deno.test("short name, display name, diacritics and case all reach the same Group", () => {
  for (
    const spelling of [
      "EDU",
      "edu",
      "Educațional",
      "educational",
      "EDUCAȚIONAL",
      "  Educaţional  ",
    ]
  ) {
    const result = parseRecruitsCsv(
      `name,email,dept,team\nAna,ana@example.com,${spelling},`,
      references,
    );
    assertEquals(result.errors, [], `${spelling} must resolve`);
    assertEquals(result.valid[0].groupIds, [1], `${spelling} must be Group 1`);
  }
});

Deno.test("a Team is resolved inside its row's Department", () => {
  const result = parseRecruitsCsv(
    [
      "name,email,dept,team",
      "Ana,ana@example.com,edu,Echipa App",
      "Mihai,mihai@example.com,PR,echipa app",
    ].join("\n"),
    references,
  );

  assertEquals(result.errors, []);
  assertEquals(result.valid.map((row) => row.groupIds), [[1, 3], [2, 4]]);
});

Deno.test("a Team that is not below its row's Department is reported on that row", () => {
  const result = parseRecruitsCsv(
    "name,email,dept,team\nAna,ana@example.com,PR,Interne\n",
    references,
  );

  assertEquals(result.valid, []);
  assertEquals(result.errors, [
    {
      row: 2,
      field: "team",
      code: "unknown_team",
      message: "Echipă inexistentă: Interne.",
    },
  ]);
});

Deno.test("a Team name that two Departments share is ambiguous without a Department", () => {
  const result = parseRecruitsCsv(
    "name,email,dept,team\nAna,ana@example.com,,Echipa App\n",
    references,
  );

  assertEquals(result.valid, []);
  assertEquals(result.errors, [
    {
      row: 2,
      field: "team",
      code: "unknown_team",
      message: "Echipă ambiguă: Echipa App.",
    },
  ]);
});

Deno.test("the same Group in both columns is appointed once", () => {
  const result = parseRecruitsCsv(
    "name,email,dept,team\nAna,ana@example.com,edu,Educațional\n",
    references,
  );

  assertEquals(result.errors, []);
  assertEquals(result.valid[0].groupIds, [1]);
});

Deno.test("BOM, CRLF, quoted fields and blank memberships are supported", () => {
  const result = parseRecruitsCsv(
    '﻿name,email,dept,team\r\n"Pop, Ana","ANA@Example.com",,\r\n' +
      '"Ionescu\nMihai",mihai@example.com,pr,\r\n\r\n',
    references,
  );

  assertEquals(result, {
    valid: [
      {
        row: 2,
        fullName: "Pop, Ana",
        email: "ana@example.com",
        groupIds: [],
      },
      {
        row: 3,
        fullName: "Ionescu\nMihai",
        email: "mihai@example.com",
        groupIds: [2],
      },
    ],
    errors: [],
  });
});

Deno.test("bad rows are collected while valid rows survive", () => {
  const result = parseRecruitsCsv(
    [
      "name,email,dept,team",
      "Ana Pop,ana@example.com,edu,",
      "   ,missing-name@example.com,edu,",
      "No At Sign,invalid.example.com,edu,",
      "Unknown Dept,dept@example.com,unknown,",
      "Unknown Team,team@example.com,edu,missing-team",
      "Both Unknown,both@example.com,missing-dept,missing-team",
    ].join("\n"),
    references,
  );

  assertEquals(result.valid, [
    {
      row: 2,
      fullName: "Ana Pop",
      email: "ana@example.com",
      groupIds: [1],
    },
  ]);
  assertEquals(result.errors, [
    {
      row: 3,
      field: "name",
      code: "name_required",
      message: "Numele este obligatoriu.",
    },
    {
      row: 4,
      field: "email",
      code: "invalid_email",
      message: "Email invalid.",
    },
    {
      row: 5,
      field: "dept",
      code: "unknown_department",
      message: "Departament inexistent: unknown.",
    },
    {
      row: 6,
      field: "team",
      code: "unknown_team",
      message: "Echipă inexistentă: missing-team.",
    },
    {
      row: 7,
      field: "dept",
      code: "unknown_department",
      message: "Departament inexistent: missing-dept.",
    },
    {
      row: 7,
      field: "team",
      code: "unknown_team",
      message: "Echipă inexistentă: missing-team.",
    },
  ]);
});

Deno.test("a data row must contain exactly four columns", () => {
  const result = parseRecruitsCsv(
    "name,email,dept,team\nAna,ana@example.com,edu\n",
    references,
  );

  assertEquals(result, {
    valid: [],
    errors: [
      {
        row: 2,
        field: "row",
        code: "invalid_column_count",
        message: "Rândul trebuie să conțină exact 4 coloane.",
      },
    ],
  });
});

Deno.test("whitespace-only records are ignored without renumbering later records", () => {
  const result = parseRecruitsCsv(
    [
      "name,email,dept,team",
      "   ,   ,   ,   ",
      "   ",
      '"Ana ""Anuța"" Pop",ana@example.com,edu,',
    ].join("\n"),
    references,
  );

  assertEquals(result, {
    valid: [
      {
        row: 4,
        fullName: 'Ana "Anuța" Pop',
        email: "ana@example.com",
        groupIds: [1],
      },
    ],
    errors: [],
  });
});

Deno.test("the exact header is required", () => {
  const error = assertThrows(
    () => parseRecruitsCsv("email,name,dept,team\na@b.ro,Ana,edu,", references),
    ParseRecruitsCsvError,
    "Antetul CSV trebuie să fie exact: name,email,dept,team.",
  );

  assertEquals(error.code, "invalid_header");
});

Deno.test("structurally malformed CSV is a file-level error", () => {
  const error = assertThrows(
    () =>
      parseRecruitsCsv(
        'name,email,dept,team\n"Ana,ana@example.com,edu,',
        references,
      ),
    ParseRecruitsCsvError,
    "Fișierul CSV nu poate fi citit.",
  );

  assertEquals(error.code, "invalid_csv");
});
