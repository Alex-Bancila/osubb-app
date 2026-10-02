// #991: the volunteer sheet's mapping, row by row. Every row here is
// invented: the real sheet never enters the repository.
import { assertEquals } from "@std/assert";
import {
  bceDepartment,
  normalizePhone,
  parseFunction,
  type PlannedRow,
  planVolunteerImport,
  readVolunteerSheet,
} from "./volunteer-sheet.ts";
import { context, sheet } from "./volunteer-sheet.fixtures.ts";

function plan(text: string, ctx = context()): PlannedRow[] {
  return planVolunteerImport(readVolunteerSheet(text) ?? [], ctx);
}

const codes = (row: PlannedRow) => row.problems.map((p) => p.code);
const roster = (row: PlannedRow) =>
  row.placements.map((p) =>
    [p.group_id, p.group_role, p.position_title] as const
  );

Deno.test("the sheet is recognised by its header; any other file is not", () => {
  assertEquals(readVolunteerSheet("name,email,dept,team\nA,a@b.ro,,\n"), null);
  assertEquals(readVolunteerSheet(""), null);
  const rows = readVolunteerSheet(
    sheet(
      "Pop Ana,Membru voluntar,ana@x.ro,712345678,Imagine&PR,Tineret,,,,01.01.2000,UBB,FSEGA,X,Licență,2",
      ",,,,,,,,,,,,,,",
    ),
  );
  assertEquals(rows, [{
    row: 2,
    name: "Pop Ana",
    functionText: "Membru voluntar",
    email: "ana@x.ro",
    phone: "712345678",
    departments: ["Imagine&PR", "Tineret"],
  }]);
});

Deno.test("a header in another column order, with a BOM, is still the sheet", () => {
  const rows = readVolunteerSheet(
    "﻿Email,Nume & Prenume,Funcția,Număr de telefon,Departament PRINCIPAL\nb@x.ro,Ion Dan,Membru voluntar,,Tineret\n",
  );
  assertEquals(rows?.[0].name, "Ion Dan");
  assertEquals(rows?.[0].departments, ["Tineret"]);
});

Deno.test("phones are stored in E.164; the sheet's nine digits get +40", () => {
  assertEquals(normalizePhone("712345678"), "+40712345678");
  assertEquals(normalizePhone("0712 345 678"), "+40712345678");
  assertEquals(normalizePhone("+40 712-345-678"), "+40712345678");
  assertEquals(normalizePhone("0037369123456"), "+37369123456");
  assertEquals(normalizePhone("12345"), null);
  assertEquals(normalizePhone(""), null);
});

Deno.test("the Funcția cell: the highest rank it names, titles and Projects", () => {
  assertEquals(parseFunction("Membru voluntar").rank, "voluntar");
  assertEquals(parseFunction("Membru cu drept de vot").rank, "vot");
  assertEquals(parseFunction("BC, Președinte"), {
    rank: "bc",
    boardTitle: "Președinte",
    boardTitleMissing: false,
    bceTitle: null,
    projectManagerOf: [],
    projectResponsible: [],
    unknown: [],
  });
  assertEquals(parseFunction("Cenzor").rank, "bc");
  assertEquals(parseFunction("Cenzor").boardTitle, "Cenzor");
  assertEquals(parseFunction("BCE, Coordonator FR").bceTitle, "Coordonator FR");
  const cp = parseFunction(
    "Coordonator Principal Festivalul Studențesc, Membru cu drept de vot",
  );
  assertEquals(cp.rank, "vot");
  assertEquals(cp.projectManagerOf, ["Festivalul Studențesc"]);
  assertEquals(
    parseFunction(
      "Responsabil Logistică Festivalul Studențesc, Membru voluntar",
    )
      .projectResponsible,
    ["Logistică Festivalul Studențesc"],
  );
});

Deno.test("the BCE area decides the managed Department (the binding table)", () => {
  assertEquals(bceDepartment("Coordonator Edu"), "Educațional");
  assertEquals(bceDepartment("Coordonator Activități Edu"), "Educațional");
  assertEquals(bceDepartment("Coordonator FR"), "Financiar");
  assertEquals(bceDepartment("Coordonator Imagine"), "Imagine & PR");
  assertEquals(bceDepartment("Coordonator PR"), "Imagine & PR");
  assertEquals(
    bceDepartment("Coordonator Gestionare Voluntari"),
    "Resurse Umane",
  );
  assertEquals(bceDepartment("Coordonator Activități de Tineret"), "Tineret");
  assertEquals(
    bceDepartment("Coordonator Dezvoltare Politici de Tineret"),
    "Tineret",
  );
  assertEquals(bceDepartment("Coordonator IT"), null);
  assertEquals(bceDepartment("Coordonator Activități Interne"), null);
  assertEquals(bceDepartment("Coordonator Scriere Proiecte"), null);
});

Deno.test("a Voluntar: trimmed name, lower-cased address, phone, principal Department first", () => {
  const [row] = plan(sheet(
    "  Pop   Ana ,Membru voluntar, Ana.Pop@X.ro ,712345678,Tineret,Imagine&PR,,,,,,,,,",
  ));
  assertEquals(row.full_name, "Pop   Ana");
  assertEquals(row.email, "ana.pop@x.ro");
  assertEquals(row.phone, "+40712345678");
  assertEquals(row.rank, "voluntar");
  assertEquals(row.action, "create");
  assertEquals(roster(row), [[2, "member", null], [1, "member", null]]);
  assertEquals(row.problems, []);
});

Deno.test('a BC row is the board\'s Responsible under the title after "BC, "; Cenzor under "Cenzor"', () => {
  const rows = plan(sheet(
    'Ion Dan,"BC, Secretar General",dan@x.ro,,Educațional,,,,,,,,,,',
    "Vlad Ina,Cenzor,ina@x.ro,,,,,,,,,,,,",
  ));
  assertEquals(rows[0].rank, "bc");
  assertEquals(roster(rows[0]), [[8, "member", null], [
    63,
    "responsible",
    "Secretar General",
  ]]);
  assertEquals(rows[1].rank, "bc");
  assertEquals(roster(rows[1]), [[63, "responsible", "Cenzor"]]);
});

Deno.test("a BC row without a board Group set imports, flagged", () => {
  const [row] = plan(
    sheet('Ion Dan,"BC, Președinte",dan@x.ro,,,,,,,,,,,,'),
    context({}, null),
  );
  assertEquals(row.action, "create");
  assertEquals(row.placements, []);
  assertEquals(codes(row), ["board_group_missing"]);
});

Deno.test("a BCE is the Manager of the Department the binding table names, in one roster row", () => {
  const [row] = plan(sheet(
    'Mara Ene,"BCE, Coordonator FR",mara@x.ro,,Financiar,Tineret,,,,,,,,,',
  ));
  assertEquals(row.rank, "bce");
  assertEquals(roster(row), [[3, "manager", "Coordonator FR"], [
    2,
    "member",
    null,
  ]]);
  assertEquals(row.problems, []);
});

Deno.test("a BCE of IT is BCE only, flagged fără poziție", () => {
  const [row] = plan(
    sheet('Ana Ilie,"BCE, Coordonator IT",ilie@x.ro,,,,,,,,,,,,'),
  );
  assertEquals(row.rank, "bce");
  assertEquals(row.placements, []);
  assertEquals(row.problems.map((p) => [p.code, p.message, p.blocking]), [
    ["no_position", "fără poziție", false],
  ]);
});

Deno.test("Coordonator Principal and Responsabil reach the Project by name", () => {
  const rows = plan(sheet(
    'Rus Ana,"Coordonator Principal Festivalul Studențesc, Membru cu drept de vot",rus@x.ro,,,,,,,,,,,,',
    'Bob Ion,"Responsabil Logistică Festivalul Studentesc, Membru voluntar",bob@x.ro,,,,,,,,,,,,',
  ));
  assertEquals(rows[0].rank, "vot");
  assertEquals(roster(rows[0]), [[60, "manager", null]]);
  assertEquals(roster(rows[1]), [[60, "responsible", "Responsabil Logistică"]]);
});

Deno.test("a Project that does not exist yet imports without the appointment, flagged proiect lipsă", () => {
  const rows = plan(sheet(
    'Rus Ana,"Coordonator Principal Gala Nouă, Membru cu drept de vot",rus@x.ro,,,,,,,,,,,,',
    'Bob Ion,"Responsabil Marketing Gala Nouă, Membru voluntar",bob@x.ro,,,,,,,,,,,,',
    'Dan Pop,"Responsabil Ceva Necunoscut, Membru voluntar",pop@x.ro,,,,,,,,,,,,',
  ));
  assertEquals(rows.map((row) => row.action), ["create", "create", "create"]);
  assertEquals(rows.map((row) => row.problems.map((p) => p.message)), [
    ["proiect lipsă: Gala Nouă"],
    ["proiect lipsă: Gala Nouă"],
    ["proiect lipsă: Ceva Necunoscut"],
  ]);
});

Deno.test("blocking problems: missing or invalid address, unknown Department, duplicate in file", () => {
  const rows = plan(sheet(
    "Fara Email,Membru voluntar,,,,,,,,,,,,,",
    "Rau Email,Membru voluntar,nu-e-email,,,,,,,,,,,,",
    "Dep Gresit,Membru voluntar,dep@x.ro,,Astronomie,,,,,,,,,,",
    "Primul,Membru voluntar,dub@x.ro,,,,,,,,,,,,",
    "Al Doilea,Membru voluntar,DUB@x.ro,,,,,,,,,,,,",
  ));
  assertEquals(rows.map((row) => [row.action, codes(row)]), [
    ["skip", ["email_required"]],
    ["skip", ["invalid_email"]],
    ["skip", ["unknown_department"]],
    ["create", []],
    ["skip", ["duplicate_in_file"]],
  ]);
  assertEquals(
    rows[4].problems[0].message,
    "Email duplicat în fișier (rândul 5).",
  );
});

Deno.test("a sub-Group or the Organization Group is never a Department", () => {
  const rows = plan(sheet(
    "A B,Membru voluntar,ab@x.ro,,Echipa IT,,,,,,,,,,",
    "C D,Membru voluntar,cd@x.ro,,OSUBB,,,,,,,,,,",
  ));
  assertEquals(rows.map(codes), [["unknown_department"], [
    "unknown_department",
  ]]);
});

Deno.test("non-blocking problems: an unreadable phone, an unknown function", () => {
  const [row] = plan(
    sheet('Ana Pop,"Membru voluntar, Astronaut",ana@x.ro,12345,,,,,,,,,,,'),
  );
  assertEquals(row.action, "create");
  assertEquals(row.phone, null);
  assertEquals(codes(row), ["invalid_phone", "unknown_function"]);
});

Deno.test("what the database knows decides the action", () => {
  const rows = plan(
    sheet(
      "Deja,Membru voluntar,deja@x.ro,,,,,,,,,,,,",
      "Importat,Membru voluntar,importat@x.ro,,,,,,,,,,,,",
      "Orfan,Membru voluntar,orfan@x.ro,,,,,,,,,,,,",
      "Confirmat,Membru voluntar,confirmat@x.ro,,,,,,,,,,,,",
    ),
    context({
      "deja@x.ro": { memberId: "m-1", imported: false, orphanUserId: null },
      "importat@x.ro": { memberId: "m-2", imported: true, orphanUserId: null },
      "orfan@x.ro": { memberId: null, imported: false, orphanUserId: "u-3" },
      "confirmat@x.ro": { memberId: null, imported: false, orphanUserId: null },
    }),
  );
  assertEquals(
    rows.map((
      row,
    ) => [row.action, row.member_id, row.orphanUserId, codes(row)]),
    [
      ["skip", null, null, ["already_member"]],
      ["complete", "m-2", null, []],
      ["create", null, "u-3", []],
      ["skip", null, null, ["auth_account_exists"]],
    ],
  );
});
