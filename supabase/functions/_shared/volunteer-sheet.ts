// #991: the volunteer-base sheet ("Baza de date oameni vechi") and how each of
// its rows maps onto what the app already models. Pure: no I/O, so the
// mapping the issue fixes as binding is tested row by row in
// volunteer-sheet.test.ts.
//
// Only data the app models is read: name, Funcția, email, phone and the
// Departments. Birth date, university, faculty, specialisation, level and
// year are ignored. Nothing is ever created from a sheet value: a Department
// or Project that does not exist is a problem on the row, never a new Group.

import { parse } from "@std/csv";
import { normalizeGroupKey } from "./groups.ts";

/** Every imported Member joined on this day (Alex, 2026-10-02). */
export const VOLUNTEER_JOINED_AT = "2026-02-22";

/** Most rows one file may hold; the real sheet has about 600. */
export const VOLUNTEER_MAX_ROWS = 2000;

export type VolunteerRank = "voluntar" | "vot" | "bce" | "bc";
export type GroupRole = "manager" | "responsible" | "member";

const RANK_ORDER: Record<VolunteerRank, number> = {
  voluntar: 1,
  vot: 3,
  bce: 5,
  bc: 6,
};
const ROLE_ORDER: Record<GroupRole, number> = {
  member: 0,
  responsible: 1,
  manager: 2,
};

/** One sheet row, as read: only the columns the import uses. */
export interface VolunteerSheetRow {
  /** 1-based line in the file; the header is row 1. */
  row: number;
  name: string;
  functionText: string;
  email: string;
  phone: string;
  /** The principal Department first, then the secondary ones, as written. */
  departments: string[];
}

/** An active Group the sheet may name. */
export interface SheetGroup {
  id: number;
  name: string;
  short: string | null;
  /** True for a Group with no parent (a Department, a Project, the board). */
  topLevel: boolean;
  isOrganization: boolean;
}

/** What the database already knows about an address in the file. */
export interface KnownAddress {
  /** The Member this address belongs to, or null. */
  memberId: string | null;
  /** Whether the volunteer import created that Member. */
  imported: boolean;
  /** An Auth account an interrupted run left without a Profile. */
  orphanUserId: string | null;
}

export interface ImportContext {
  groups: readonly SheetGroup[];
  /** org_settings.board_group_id: the Biroul de Conducere Group. */
  boardGroupId: number | null;
  /** Keyed by the lower-cased address. */
  known: ReadonlyMap<string, KnownAddress>;
}

export interface Placement {
  group_id: number;
  group_name: string;
  group_role: GroupRole;
  position_title: string | null;
}

export interface Problem {
  code: string;
  message: string;
  /** A blocking problem keeps the row out of the import. */
  blocking: boolean;
}

export type PlanAction = "create" | "complete" | "skip";

export interface PlannedRow {
  row: number;
  full_name: string;
  email: string;
  phone: string | null;
  rank: VolunteerRank;
  function: string;
  action: PlanAction;
  member_id: string | null;
  placements: Placement[];
  problems: Problem[];
  /** Internal: an Auth account to reuse; never sent to the browser. */
  orphanUserId: string | null;
}

const COLUMN = {
  name: "nume & prenume",
  functionText: "functia",
  email: "email",
  phone: "numar de telefon",
  principal: "departament principal",
  secondary: "departament secundar",
} as const;

function headerKey(value: string): string {
  return normalizeGroupKey(value);
}

/**
 * The sheet's rows when `text` is the volunteer sheet (recognised by its
 * header, in any column order), or null for any other file -- the old
 * `name,email,dept,team` format keeps its own parser.
 */
export function readVolunteerSheet(text: string): VolunteerSheetRow[] | null {
  let records: string[][];
  try {
    records = parse(text.replace(/^﻿/, ""), {
      skipFirstRow: false,
      fieldsPerRecord: -1,
    }) as string[][];
  } catch {
    return null;
  }
  const [header, ...rows] = records;
  if (!header) return null;
  const keys = header.map(headerKey);
  const at = (key: string) => keys.indexOf(key);
  const name = at(COLUMN.name);
  const functionText = at(COLUMN.functionText);
  const email = at(COLUMN.email);
  const phone = at(COLUMN.phone);
  const principal = at(COLUMN.principal);
  if ([name, functionText, email, phone, principal].some((i) => i < 0)) {
    return null;
  }
  const secondary = keys.flatMap((key, index) =>
    key === COLUMN.secondary ? [index] : []
  );

  const result: VolunteerSheetRow[] = [];
  for (const [index, fields] of rows.entries()) {
    if (fields.every((field) => field.trim() === "")) continue;
    const cell = (i: number) => (fields[i] ?? "").trim();
    const departments = [principal, ...secondary].map(cell).filter(Boolean);
    result.push({
      row: index + 2,
      name: cell(name),
      functionText: cell(functionText),
      email: cell(email),
      phone: cell(phone),
      departments,
    });
  }
  return result;
}

/**
 * A phone number in E.164, or null when it cannot be read -- the same rule as
 * the database's private.normalize_phone, so what the dry-run shows is what
 * profiles_normalize_phone stores. The sheet writes Romanian numbers as nine
 * digits without the leading 0.
 */
export function normalizePhone(raw: string): string | null {
  let value = raw.replace(/[\s.()-]/g, "");
  if (!value) return null;
  if (value.startsWith("00")) value = "+" + value.slice(2);
  else if (!value.startsWith("+")) value = "+40" + value;
  if (!/^\+[0-9]+$/.test(value)) return null;
  if (value.startsWith("+40")) {
    const digits = value.slice(3).replace(/^0/, "");
    return /^7[0-9]{8}$/.test(digits) ? "+40" + digits : null;
  }
  if (value.startsWith("+373")) {
    const digits = value.slice(4).replace(/^0/, "");
    return /^[0-9]{8}$/.test(digits) ? "+373" + digits : null;
  }
  return /^\+[1-9][0-9]{7,14}$/.test(value) ? value : null;
}

/** What one Funcția cell says. */
export interface ParsedFunction {
  rank: VolunteerRank | null;
  /** The custom title after "BC, ", or "Cenzor". */
  boardTitle: string | null;
  /** True when the cell names BC (or Cenzor) but no title follows. */
  boardTitleMissing: boolean;
  /** The title after "BCE, " -- "Coordonator Edu". */
  bceTitle: string | null;
  /** `Coordonator Principal <P>`: the Projects, as written. */
  projectManagerOf: string[];
  /** `Responsabil <x> <P>`: everything after "Responsabil ", as written. */
  projectResponsible: string[];
  /** Parts the import does not understand. */
  unknown: string[];
}

const RANK_WORDS: Record<string, VolunteerRank> = {
  "membru voluntar": "voluntar",
  "membru cu drept de vot": "vot",
};

function isFunctionKeyword(folded: string): boolean {
  return folded === "bc" || folded === "bce" || folded === "cenzor" ||
    folded in RANK_WORDS || folded.startsWith("coordonator principal ") ||
    folded.startsWith("responsabil ");
}

function higherRank(
  current: VolunteerRank | null,
  next: VolunteerRank,
): VolunteerRank {
  return current === null || RANK_ORDER[next] > RANK_ORDER[current]
    ? next
    : current;
}

export function parseFunction(text: string): ParsedFunction {
  const result: ParsedFunction = {
    rank: null,
    boardTitle: null,
    boardTitleMissing: false,
    bceTitle: null,
    projectManagerOf: [],
    projectResponsible: [],
    unknown: [],
  };
  const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const folded = normalizeGroupKey(part);
    const next = parts[i + 1];
    const nextIsTitle = next !== undefined &&
      !isFunctionKeyword(normalizeGroupKey(next));
    if (folded === "bc") {
      result.rank = higherRank(result.rank, "bc");
      if (nextIsTitle) {
        result.boardTitle = next;
        i++;
      } else {
        result.boardTitleMissing = true;
      }
    } else if (folded === "bce") {
      result.rank = higherRank(result.rank, "bce");
      if (nextIsTitle) {
        result.bceTitle = next;
        i++;
      }
    } else if (folded === "cenzor") {
      result.rank = higherRank(result.rank, "bc");
      result.boardTitle = "Cenzor";
    } else if (folded in RANK_WORDS) {
      result.rank = higherRank(result.rank, RANK_WORDS[folded]);
    } else if (folded.startsWith("coordonator principal ")) {
      result.projectManagerOf.push(
        part.replace(/^\S+\s+\S+\s+/, "").trim(),
      );
    } else if (folded.startsWith("responsabil ")) {
      result.projectResponsible.push(part.replace(/^\S+\s+/, "").trim());
    } else {
      result.unknown.push(part);
    }
  }
  return result;
}

/**
 * The Department a BCE Coordonator manages, by the area after "Coordonator"
 * (the issue's binding table). Null for an area with no Department of its
 * own (IT, Activități Interne, Scriere Proiecte) and for any area not listed.
 */
const BCE_DEPARTMENTS: Readonly<Record<string, string | null>> = {
  "edu": "Educațional",
  "activitati edu": "Educațional",
  "fr": "Financiar",
  "imagine": "Imagine & PR",
  "pr": "Imagine & PR",
  "gestionare voluntari": "Resurse Umane",
  "activitati de tineret": "Tineret",
  "dezvoltare politici de tineret": "Tineret",
  "it": null,
  "activitati interne": null,
  "scriere proiecte": null,
};

export function bceDepartment(bceTitle: string): string | null {
  const area = normalizeGroupKey(bceTitle).replace(/^coordonator\s+/, "");
  return BCE_DEPARTMENTS[area] ?? null;
}

/** A Department name, compared without case, diacritics or any spacing. */
function departmentKey(value: string): string {
  return normalizeGroupKey(value).replace(/\s+/g, "");
}

const TITLE_LIMIT = 80;
const NAME_LIMIT = 120;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function problem(code: string, message: string, blocking: boolean): Problem {
  return { code, message, blocking };
}

/** The plan for every row: rank, Groups, positions, titles and problems. */
export function planVolunteerImport(
  rows: readonly VolunteerSheetRow[],
  context: ImportContext,
): PlannedRow[] {
  const usable = context.groups.filter((group) => !group.isOrganization);
  const byId = new Map(usable.map((group) => [group.id, group]));

  // Departments: top-level Groups, by display or short name.
  const departments = new Map<string, number[]>();
  const rememberDepartment = (value: string | null, id: number) => {
    if (!value) return;
    const key = departmentKey(value);
    const ids = departments.get(key) ?? [];
    if (!ids.includes(id)) ids.push(id);
    departments.set(key, ids);
  };
  for (const group of usable) {
    if (!group.topLevel || group.id === context.boardGroupId) continue;
    rememberDepartment(group.name, group.id);
    rememberDepartment(group.short, group.id);
  }

  // Projects: any Group but the board, by display name.
  const projects = new Map<string, number[]>();
  for (const group of usable) {
    if (group.id === context.boardGroupId) continue;
    const key = normalizeGroupKey(group.name);
    projects.set(key, [...(projects.get(key) ?? []), group.id]);
  }
  // The Project names a `Responsabil <x> <P>` cell may end with: every
  // Group's name, and every `Coordonator Principal <P>` the file itself
  // names (so a Project not created yet is still told apart from <x>).
  const projectNames = new Map<string, string>();
  for (const group of usable) {
    if (group.id !== context.boardGroupId) {
      projectNames.set(normalizeGroupKey(group.name), group.name);
    }
  }
  for (const row of rows) {
    for (const name of parseFunction(row.functionText).projectManagerOf) {
      const key = normalizeGroupKey(name);
      if (key && !projectNames.has(key)) projectNames.set(key, name);
    }
  }

  const firstRowOf = new Map<string, number>();
  const planned: PlannedRow[] = [];

  for (const sheetRow of rows) {
    const problems: Problem[] = [];
    const fullName = sheetRow.name.trim();
    const email = sheetRow.email.trim().toLowerCase();

    if (!fullName) {
      problems.push(problem("name_required", "Numele lipsește.", true));
    } else if (fullName.length > NAME_LIMIT) {
      problems.push(
        problem("name_too_long", "Numele depășește 120 de caractere.", true),
      );
    }
    if (!email) {
      problems.push(problem("email_required", "Emailul lipsește.", true));
    } else if (!EMAIL.test(email)) {
      problems.push(problem("invalid_email", "Email invalid.", true));
    } else if (firstRowOf.has(email)) {
      problems.push(
        problem(
          "duplicate_in_file",
          `Email duplicat în fișier (rândul ${firstRowOf.get(email)}).`,
          true,
        ),
      );
    } else {
      firstRowOf.set(email, sheetRow.row);
    }

    let phone: string | null = null;
    if (sheetRow.phone) {
      phone = normalizePhone(sheetRow.phone);
      if (phone === null) {
        problems.push(
          problem(
            "invalid_phone",
            "Telefon invalid: contul se creează fără telefon.",
            false,
          ),
        );
      }
    }

    const parsed = parseFunction(sheetRow.functionText);
    let rank = parsed.rank;
    if (rank === null) {
      rank = "voluntar";
      problems.push(
        problem(
          "rank_defaulted",
          "Funcția nu numește un rang: se importă ca Voluntar.",
          false,
        ),
      );
    }
    for (const part of parsed.unknown) {
      problems.push(
        problem("unknown_function", `Funcție necunoscută: ${part}.`, false),
      );
    }

    // The placements, in roster order: the principal Department first.
    const placements = new Map<number, Placement>();
    const place = (
      groupId: number,
      role: GroupRole,
      title: string | null,
    ) => {
      const group = byId.get(groupId);
      if (!group) return;
      const current = placements.get(groupId);
      if (current && ROLE_ORDER[current.group_role] >= ROLE_ORDER[role]) {
        return;
      }
      placements.set(groupId, {
        group_id: groupId,
        group_name: group.name,
        group_role: role,
        position_title: role === "member" ? null : title,
      });
    };
    const fitTitle = (title: string): string | null => {
      const trimmed = title.trim();
      if (trimmed.length <= TITLE_LIMIT) return trimmed;
      problems.push(
        problem(
          "title_too_long",
          `Titlu prea lung (peste 80 de caractere): ${trimmed}.`,
          false,
        ),
      );
      return null;
    };

    for (const name of sheetRow.departments) {
      const ids = departments.get(departmentKey(name)) ?? [];
      if (ids.length === 1) {
        place(ids[0], "member", null);
      } else {
        problems.push(
          problem(
            "unknown_department",
            ids.length === 0
              ? `Departament inexistent: ${name}.`
              : `Departament ambiguu: ${name}.`,
            true,
          ),
        );
      }
    }

    if (rank === "bce") {
      const departmentName = parsed.bceTitle
        ? bceDepartment(parsed.bceTitle)
        : null;
      const ids = departmentName
        ? departments.get(departmentKey(departmentName)) ?? []
        : [];
      const title = parsed.bceTitle ? fitTitle(parsed.bceTitle) : null;
      if (ids.length === 1) {
        place(ids[0], "manager", title);
      } else {
        problems.push(
          problem(
            "no_position",
            departmentName
              ? `fără poziție: Departamentul ${departmentName} nu există.`
              : "fără poziție",
            false,
          ),
        );
      }
    }

    for (const projectName of parsed.projectManagerOf) {
      const ids = projects.get(normalizeGroupKey(projectName)) ?? [];
      if (ids.length === 1) {
        place(ids[0], "manager", null);
      } else {
        problems.push(
          problem(
            "project_missing",
            ids.length === 0
              ? `proiect lipsă: ${projectName}`
              : `proiect ambiguu: ${projectName}`,
            false,
          ),
        );
      }
    }

    for (const rest of parsed.projectResponsible) {
      const words = rest.split(/\s+/).filter(Boolean);
      const folded = words.map(normalizeGroupKey);
      // The longest known Project name the cell ends with.
      let match: { key: string; name: string; length: number } | null = null;
      for (const [key, name] of projectNames) {
        const keyWords = key.split(" ");
        if (keyWords.length > folded.length) continue;
        const tail = folded.slice(folded.length - keyWords.length).join(" ");
        if (tail === key && (!match || keyWords.length > match.length)) {
          match = { key, name, length: keyWords.length };
        }
      }
      if (!match) {
        problems.push(
          problem("project_missing", `proiect lipsă: ${rest}`, false),
        );
        continue;
      }
      const area = words.slice(0, words.length - match.length).join(" ");
      const title = fitTitle(area ? `Responsabil ${area}` : "Responsabil");
      const ids = projects.get(match.key) ?? [];
      if (ids.length === 1 && title) {
        place(ids[0], "responsible", title);
      } else if (ids.length !== 1) {
        problems.push(
          problem(
            "project_missing",
            ids.length === 0
              ? `proiect lipsă: ${match.name}`
              : `proiect ambiguu: ${match.name}`,
            false,
          ),
        );
      }
    }

    if (rank === "bc") {
      const title = parsed.boardTitle ? fitTitle(parsed.boardTitle) : null;
      if (parsed.boardTitleMissing && !parsed.boardTitle) {
        problems.push(
          problem(
            "board_title_missing",
            "BC fără titlu: nu este numit în Biroul de Conducere.",
            false,
          ),
        );
      } else if (
        context.boardGroupId === null || !byId.has(context.boardGroupId)
      ) {
        problems.push(
          problem(
            "board_group_missing",
            "Grupul Biroul de Conducere nu este setat (Setări): titlul BC nu se atribuie.",
            false,
          ),
        );
      } else if (title) {
        place(context.boardGroupId, "responsible", title);
      }
    }

    // What the database already knows about the address.
    let action: PlanAction = "create";
    let memberId: string | null = null;
    let orphanUserId: string | null = null;
    const known = email ? context.known.get(email) : undefined;
    if (known?.memberId) {
      if (known.imported) {
        action = "complete";
        memberId = known.memberId;
      } else {
        problems.push(
          problem(
            "already_member",
            "Adresa aparține deja unui membru: rândul nu se importă.",
            true,
          ),
        );
      }
    } else if (known?.orphanUserId) {
      orphanUserId = known.orphanUserId;
    } else if (known) {
      problems.push(
        problem(
          "auth_account_exists",
          "Există deja un cont de autentificare pentru această adresă.",
          true,
        ),
      );
    }
    if (problems.some((p) => p.blocking)) action = "skip";

    planned.push({
      row: sheetRow.row,
      full_name: fullName,
      email,
      phone,
      rank,
      function: sheetRow.functionText,
      action,
      member_id: memberId,
      placements: [...placements.values()],
      problems,
      orphanUserId,
    });
  }
  return planned;
}

/** The notes stored with an imported Member: every non-blocking problem. */
export function importNotes(row: PlannedRow): string[] {
  return row.problems.filter((p) => !p.blocking).map((p) =>
    p.message.slice(0, 200)
  ).slice(0, 20);
}
