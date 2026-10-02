// #991: the volunteer-sheet format of csv-import -- a dry-run that answers the
// plan for every row, and an apply that creates the accounts WITHOUT sending
// any email (Auth's admin createUser with the address unconfirmed; the
// invitations go out later, in batches, through send-invitations).
//
// POST { csv, mode: "dry_run" }            (the default)
//   200 { format: "volunteers", mode: "dry_run", summary, rows: PlanRow[] }
// POST { csv, mode: "apply", rows?: number[] }
//   200 { format: "volunteers", mode: "apply", summary, rows: ApplyRow[] }
//   `rows` names the sheet rows to apply (at most 100 per call, so the app
//   can show progress and no call outlives the function's time limit);
//   omitted, every row of the file, which must then be at most 100 to apply.
//
// Per row, apply is atomic and idempotent: the account is created (or an
// orphan from an interrupted run reused), then public.import_member writes
// the Profile, phone and every Appointment in one transaction; when that
// fails, an account this call created is deleted again -- safe, because no
// email was ever sent to it. A row imported before is completed, never
// created twice.

import { json, refusal } from "../_shared/cors.ts";
import type { DbError } from "../_shared/member-invite.ts";
import { GROUP_REFUSAL_MESSAGES } from "../_shared/member-invite.ts";
import {
  importNotes,
  type KnownAddress,
  type Placement,
  type PlannedRow,
  planVolunteerImport,
  type Problem,
  type SheetGroup,
  VOLUNTEER_JOINED_AT,
  VOLUNTEER_MAX_ROWS,
  type VolunteerRank,
  type VolunteerSheetRow,
} from "../_shared/volunteer-sheet.ts";

/** Most rows one apply call writes. */
export const APPLY_LIMIT = 100;

export type AuthError = DbError & { status?: number };

export interface ImportMemberArgs {
  userId: string;
  fullName: string;
  email: string;
  rank: VolunteerRank;
  phone: string | null;
  joinedAt: string;
  placements: Array<
    Pick<Placement, "group_id" | "group_role" | "position_title">
  >;
  problems: string[];
  sheetRow: number;
  importedBy: string;
}

export interface ImportedPlacement {
  group_id: number;
  group_role: string;
  position_title: string | null;
  status: "appointed" | "present" | "conflict";
}

export interface ImportMemberResult {
  member_id: string;
  outcome: "created" | "completed";
  placements: ImportedPlacement[];
}

export interface VolunteerImportDeps {
  /** Every active Group, for resolving Department and Project names. */
  importGroups(): Promise<SheetGroup[]>;
  /** org_settings.board_group_id, or null when unset. */
  boardGroupId(): Promise<number | null>;
  /** public.import_member_lookup, keyed by the lower-cased address. */
  lookupAddresses(emails: string[]): Promise<Map<string, KnownAddress>>;
  /** Auth admin createUser, address unconfirmed: sends no email. */
  createAccount(email: string): Promise<{ userId?: string; error?: AuthError }>;
  /** public.import_member. */
  importMember(
    args: ImportMemberArgs,
  ): Promise<{ result?: ImportMemberResult; error?: DbError }>;
  deleteUser(userId: string): Promise<void>;
}

type PlanRow = Omit<PlannedRow, "orphanUserId">;

interface ApplyRow {
  row: number;
  email: string;
  outcome: "created" | "completed" | "skipped" | "failed";
  member_id?: string;
  code?: string;
  message?: string;
  placements?: ImportedPlacement[];
  problems: Problem[];
}

function publicRow({ orphanUserId: _, ...row }: PlannedRow): PlanRow {
  return row;
}

function isDuplicate(error: AuthError): boolean {
  return error.status === 422 ||
    /already been registered|already exists/i.test(error.message);
}

/** A database reason is vocabulary and may leave; its prose never does (L4). */
function failure(error: DbError): { code: string; message: string } {
  if (error.code === "23505") {
    return {
      code: "already_exists",
      message: "Adresa este deja folosită de alt cont.",
    };
  }
  const reason = /^[a-z][a-z0-9_]{2,63}$/.test(error.message)
    ? error.message
    : "import_failed";
  const messages: Record<string, string> = {
    ...GROUP_REFUSAL_MESSAGES,
    phone_invalid: "Telefon invalid.",
    full_name_too_long: "Numele depășește 120 de caractere.",
    member_not_imported: "Adresa aparține unui membru care nu a fost importat.",
    member_manage_forbidden: "Doar BC poate importa membri.",
    position_title_too_long: "Un titlu depășește 80 de caractere.",
  };
  return {
    code: reason,
    message: messages[reason] ?? "Importul acestui rând a eșuat.",
  };
}

export async function handleVolunteerImport(
  body: Record<string, unknown>,
  sheet: VolunteerSheetRow[],
  callerId: string,
  deps: VolunteerImportDeps,
  origin: string | null,
): Promise<Response> {
  const mode = body.mode ?? "dry_run";
  if (mode !== "dry_run" && mode !== "apply") {
    return refusal(
      "invalid_mode",
      "mode trebuie să fie „dry_run” sau „apply”.",
      400,
      origin,
    );
  }
  if (sheet.length > VOLUNTEER_MAX_ROWS) {
    return refusal(
      "too_many_rows",
      `Un fișier poate conține cel mult ${VOLUNTEER_MAX_ROWS} de rânduri.`,
      413,
      origin,
    );
  }
  let wanted: Set<number> | null = null;
  if (mode === "apply" && body.rows !== undefined) {
    if (
      !Array.isArray(body.rows) ||
      !body.rows.every((n) => Number.isInteger(n) && n >= 2)
    ) {
      return refusal(
        "invalid_rows",
        "rows trebuie să fie o listă de numere de rând.",
        400,
        origin,
      );
    }
    wanted = new Set(body.rows as number[]);
    if (wanted.size > APPLY_LIMIT) {
      return refusal(
        "too_many_rows",
        `Un import aplică cel mult ${APPLY_LIMIT} de rânduri odată.`,
        413,
        origin,
      );
    }
  }

  let plan: PlannedRow[];
  try {
    const [groups, boardGroupId, known] = await Promise.all([
      deps.importGroups(),
      deps.boardGroupId(),
      deps.lookupAddresses(
        sheet.map((row) => row.email.trim().toLowerCase()).filter(Boolean),
      ),
    ]);
    plan = planVolunteerImport(sheet, { groups, boardGroupId, known });
  } catch (error) {
    console.error("csv-import volunteer reference load failed", {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return refusal(
      "references_load_failed",
      "Nu am putut încărca grupurile și membrii existenți.",
      500,
      origin,
    );
  }

  if (mode === "dry_run") {
    return json(
      {
        format: "volunteers",
        mode,
        summary: {
          rows: plan.length,
          create: plan.filter((row) => row.action === "create").length,
          complete: plan.filter((row) => row.action === "complete").length,
          skip: plan.filter((row) => row.action === "skip").length,
          with_warnings: plan.filter((row) =>
            row.problems.some((p) => !p.blocking)
          )
            .length,
        },
        rows: plan.map(publicRow),
      },
      200,
      origin,
    );
  }

  const selected = wanted ? plan.filter((row) => wanted.has(row.row)) : plan;
  if (selected.length > APPLY_LIMIT) {
    return refusal(
      "too_many_rows",
      `Un import aplică cel mult ${APPLY_LIMIT} de rânduri odată: trimite rândurile în loturi (câmpul rows).`,
      413,
      origin,
    );
  }

  const results: ApplyRow[] = [];
  if (wanted) {
    const present = new Set(plan.map((row) => row.row));
    for (const row of [...wanted].sort((a, b) => a - b)) {
      if (!present.has(row)) {
        results.push({
          row,
          email: "",
          outcome: "skipped",
          code: "row_not_found",
          message: "Rândul nu există în fișier.",
          problems: [],
        });
      }
    }
  }

  for (const row of selected) {
    const blocking = row.problems.find((p) => p.blocking);
    if (row.action === "skip" || blocking) {
      results.push({
        row: row.row,
        email: row.email,
        outcome: "skipped",
        code: blocking?.code ?? "skipped",
        message: blocking?.message,
        problems: row.problems,
      });
      continue;
    }
    results.push(await applyRow(row, callerId, deps));
  }
  results.sort((a, b) => a.row - b.row);

  const count = (outcome: ApplyRow["outcome"]) =>
    results.filter((row) => row.outcome === outcome).length;
  return json(
    {
      format: "volunteers",
      mode,
      summary: {
        created: count("created"),
        completed: count("completed"),
        skipped: count("skipped"),
        failed: count("failed"),
      },
      rows: results,
    },
    200,
    origin,
  );
}

async function applyRow(
  row: PlannedRow,
  callerId: string,
  deps: VolunteerImportDeps,
): Promise<ApplyRow> {
  const failed = (code: string, message: string): ApplyRow => ({
    row: row.row,
    email: row.email,
    outcome: "failed",
    code,
    message,
    problems: row.problems,
  });

  let createdHere: string | null = null;
  try {
    let userId = row.member_id ?? row.orphanUserId;
    if (!userId) {
      const account = await deps.createAccount(row.email);
      if (account.error || !account.userId) {
        if (account.error && isDuplicate(account.error)) {
          // Another call created it a moment ago, or a run was interrupted:
          // reuse it only when nobody has used it yet.
          const again = (await deps.lookupAddresses([row.email])).get(
            row.email,
          );
          userId = again?.orphanUserId ?? null;
        }
        if (!userId) {
          return failed(
            account.error && isDuplicate(account.error)
              ? "auth_account_exists"
              : "account_create_failed",
            account.error && isDuplicate(account.error)
              ? "Există deja un cont de autentificare pentru această adresă."
              : "Contul nu a putut fi creat.",
          );
        }
      } else {
        userId = account.userId;
        createdHere = account.userId;
      }
    }

    const imported = await deps.importMember({
      userId,
      fullName: row.full_name,
      email: row.email,
      rank: row.rank,
      phone: row.phone,
      joinedAt: VOLUNTEER_JOINED_AT,
      placements: row.placements.map(
        ({ group_id, group_role, position_title }) => ({
          group_id,
          group_role,
          position_title,
        }),
      ),
      problems: importNotes(row),
      sheetRow: row.row,
      importedBy: callerId,
    });
    if (imported.error || !imported.result) {
      if (createdHere) await deleteIfUnused(deps, row.email, createdHere);
      const { code, message } = failure(
        imported.error ?? { message: "import_failed" },
      );
      return failed(code, message);
    }
    return {
      row: row.row,
      email: row.email,
      outcome: imported.result.outcome,
      member_id: imported.result.member_id,
      placements: imported.result.placements,
      problems: row.problems,
    };
  } catch (error) {
    console.error("csv-import volunteer row failed", {
      row: row.row,
      errorType: error instanceof Error ? error.name : typeof error,
    });
    if (createdHere) await deleteIfUnused(deps, row.email, createdHere);
    return failed("unexpected_error", "Importul acestui rând a eșuat.");
  }
}

/**
 * Deletes an account this call created, but only while it is still an
 * orphan: a concurrent call may have found it through the duplicate path and
 * imported it, and that Member's account must survive this row's failure.
 * When the address cannot be checked, nothing is deleted -- the next run
 * reuses the orphan anyway.
 */
async function deleteIfUnused(
  deps: VolunteerImportDeps,
  email: string,
  userId: string,
) {
  try {
    const known = (await deps.lookupAddresses([email])).get(email);
    if (known?.orphanUserId !== userId) return;
    await deps.deleteUser(userId);
  } catch (error) {
    // The next run finds the account as an orphan and reuses it.
    console.error("csv-import could not delete an unused account", {
      errorType: error instanceof Error ? error.name : typeof error,
    });
  }
}
