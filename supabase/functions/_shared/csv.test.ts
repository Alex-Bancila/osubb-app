import { assertEquals, assertThrows } from "@std/assert";
import { parseRecruitsCsv, ParseRecruitsCsvError } from "./csv.ts";

const references = {
  departmentIds: new Set(["edu", "pr"]),
  teamIds: new Set(["t-app"]),
};

Deno.test("a valid recruit row is normalized for provisioning", () => {
  const result = parseRecruitsCsv(
    "name,email,dept,team\n  Ana Pop  ,  ANA@EXAMPLE.COM  ,edu,t-app\n",
    references,
  );

  assertEquals(result, {
    valid: [
      {
        row: 2,
        fullName: "Ana Pop",
        email: "ana@example.com",
        deptIds: ["edu"],
        teamIds: ["t-app"],
      },
    ],
    errors: [],
  });
});

Deno.test("BOM, CRLF, quoted fields and blank memberships are supported", () => {
  const result = parseRecruitsCsv(
    '\uFEFFname,email,dept,team\r\n"Pop, Ana","ANA@Example.com",,\r\n' +
      '"Ionescu\nMihai",mihai@example.com,pr,t-app\r\n\r\n',
    references,
  );

  assertEquals(result, {
    valid: [
      {
        row: 2,
        fullName: "Pop, Ana",
        email: "ana@example.com",
        deptIds: [],
        teamIds: [],
      },
      {
        row: 3,
        fullName: "Ionescu\nMihai",
        email: "mihai@example.com",
        deptIds: ["pr"],
        teamIds: ["t-app"],
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
      deptIds: ["edu"],
      teamIds: [],
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
        deptIds: ["edu"],
        teamIds: [],
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
