import { parse } from "@std/csv";

export interface RecruitCsvReferences {
  departmentIds: ReadonlySet<string>;
  teamIds: ReadonlySet<string>;
}

export interface RecruitCsvRow {
  row: number;
  fullName: string;
  email: string;
  deptIds: string[];
  teamIds: string[];
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
    if (dept && !references.departmentIds.has(dept)) {
      errors.push({
        row,
        field: "dept",
        code: "unknown_department",
        message: `Departament inexistent: ${dept}.`,
      });
    }
    if (team && !references.teamIds.has(team)) {
      errors.push({
        row,
        field: "team",
        code: "unknown_team",
        message: `Echipă inexistentă: ${team}.`,
      });
    }

    if (errors.length === firstError) {
      valid.push({
        row,
        fullName,
        email,
        deptIds: dept ? [dept] : [],
        teamIds: team ? [team] : [],
      });
    }
  }

  return { valid, errors };
}
