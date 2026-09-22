import { parse } from "@std/csv";
import type { GroupLookup } from "./groups.ts";

/**
 * What a row's `dept` and `team` values are resolved against (#602). The header
 * is unchanged; only what the two columns MEAN moved from legacy ids to Groups.
 */
export type RecruitCsvReferences = GroupLookup;

export interface RecruitCsvRow {
  row: number;
  fullName: string;
  email: string;
  /** The Groups this recruit is appointed into, in file order, deduplicated. */
  groupIds: number[];
}

export interface RecruitCsvError {
  row: number;
  field: "row" | "name" | "email" | "dept" | "team";
  code: string;
  message: string;
}

export interface RecruitCsvResult {
  valid: RecruitCsvRow[];
  errors: RecruitCsvError[];
}

export class ParseRecruitsCsvError extends Error {
  constructor(public readonly code: "invalid_header" | "invalid_csv") {
    super(
      code === "invalid_header"
        ? "Antetul CSV trebuie să fie exact: name,email,dept,team."
        : "Fișierul CSV nu poate fi citit.",
    );
    this.name = "ParseRecruitsCsvError";
  }
}

export function parseRecruitsCsv(
  text: string,
  references: RecruitCsvReferences,
): RecruitCsvResult {
  let records: string[][];
  try {
    records = parse(text.replace(/^\uFEFF/, ""), {
      skipFirstRow: false,
    }) as string[][];
  } catch {
    throw new ParseRecruitsCsvError("invalid_csv");
  }

  const [header, ...rows] = records;
  if (
    !header || header.length !== 4 ||
    header.some((field, index) =>
      field !== ["name", "email", "dept", "team"][index]
    )
  ) {
    throw new ParseRecruitsCsvError("invalid_header");
  }

  const valid: RecruitCsvRow[] = [];
  const errors: RecruitCsvError[] = [];

  for (const [index, fields] of rows.entries()) {
    const row = index + 2;
    if (fields.length === 0 || fields.every((field) => field.trim() === "")) {
      continue;
    }

    if (fields.length !== 4) {
      errors.push({
        row,
        field: "row",
        code: "invalid_column_count",
        message: "Rândul trebuie să conțină exact 4 coloane.",
      });
      continue;
    }

    const [rawName, rawEmail, rawDept, rawTeam] = fields;
    const fullName = rawName.trim();
    const email = rawEmail.trim().toLowerCase();
    const dept = rawDept.trim();
    const team = rawTeam.trim();
    const firstError = errors.length;

    if (!fullName) {
      errors.push({
        row,
        field: "name",
        code: "name_required",
        message: "Numele este obligatoriu.",
      });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push({
        row,
        field: "email",
        code: "invalid_email",
        message: "Email invalid.",
      });
    }
    // A `dept` value names one active Group by short or display name. Two
    // Groups answering to the same spelling is reported rather than guessed:
    // picking one would put a recruit in the wrong Department silently, and
    // the row-level codes stay the ones the panel already renders.
    let deptId: number | null = null;
    if (dept) {
      const candidates = references.resolve(dept);
      if (candidates.length === 0) {
        errors.push({
          row,
          field: "dept",
          code: "unknown_department",
          message: `Departament inexistent: ${dept}.`,
        });
      } else if (candidates.length > 1) {
        errors.push({
          row,
          field: "dept",
          code: "unknown_department",
          message: `Departament ambiguu: ${dept}.`,
        });
      } else {
        deptId = candidates[0];
      }
    }

    // A `team` value is resolved INSIDE its row's Department: the same Team
    // name under two Departments is ordinary, and a Team that is not below the
    // Department named on the row is not that row's Team at all — it is
    // reported with the same `unknown_team` code, because from the
    // spreadsheet's point of view there is no such Team in that Department.
    let teamId: number | null = null;
    if (team) {
      const resolved = references.resolve(team);
      const candidates = deptId === null
        ? resolved
        : resolved.filter((id) => references.isBelow(id, deptId as number));
      if (candidates.length === 0) {
        errors.push({
          row,
          field: "team",
          code: "unknown_team",
          message: `Echipă inexistentă: ${team}.`,
        });
      } else if (candidates.length > 1) {
        errors.push({
          row,
          field: "team",
          code: "unknown_team",
          message: `Echipă ambiguă: ${team}.`,
        });
      } else {
        teamId = candidates[0];
      }
    }

    if (errors.length === firstError) {
      const groupIds = [...new Set([deptId, teamId])].filter(
        (id): id is number => id !== null,
      );
      valid.push({ row, fullName, email, groupIds });
    }
  }

  return { valid, errors };
}
