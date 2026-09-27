import type {
  InviteMemberInput,
  InviteMemberResult,
} from "../_shared/member-invite.ts";
import {
  corsHeaders,
  isAllowedOrigin,
  json,
  refusal,
} from "../_shared/cors.ts";
import {
  parseRecruitsCsv,
  ParseRecruitsCsvError,
  type RecruitCsvReferences,
  type RecruitCsvResult,
} from "../_shared/csv.ts";
import { buildGroupLookup, type GroupReference } from "../_shared/groups.ts";

export interface CsvImportDeps {
  callerId(): Promise<string | null>;
  memberLevel(userId: string): Promise<number>;
  /** Every active Group, loaded ONCE per request and shared by every row. */
  activeGroups(): Promise<GroupReference[]>;
  invite(
    input: InviteMemberInput,
    references: RecruitCsvReferences,
  ): Promise<InviteMemberResult>;
}

interface CsvImportRowError {
  row: number;
  email?: string;
  field: "row" | "name" | "email" | "dept" | "team";
  code: string;
  message: string;
}

export async function handleCsvImport(
  request: Request,
  deps: CsvImportDeps,
): Promise<Response> {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") {
    if (!isAllowedOrigin(origin)) {
      return new Response(null, { status: 403, headers: corsHeaders(origin) });
    }
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (request.method !== "POST") {
    return refusal("method_not_allowed", "Use POST.", 405, origin);
  }
  if (
    !(request.headers.get("Content-Type") ?? "").toLowerCase().startsWith(
      "application/json",
    )
  ) {
    return refusal(
      "unsupported_media_type",
      "Folosește Content-Type: application/json.",
      415,
      origin,
    );
  }
  if (!(request.headers.get("Authorization") ?? "").startsWith("Bearer ")) {
    return refusal(
      "not_signed_in",
      "Autentifică-te pentru a importa membri.",
      401,
      origin,
    );
  }
  let callerId: string | null;
  try {
    callerId = await deps.callerId();
  } catch {
    return refusal(
      "session_invalid",
      "Sesiune invalidă sau expirată.",
      401,
      origin,
    );
  }
  if (!callerId) {
    return refusal(
      "session_invalid",
      "Sesiune invalidă sau expirată.",
      401,
      origin,
    );
  }
  let callerLevel: number;
  try {
    callerLevel = await deps.memberLevel(callerId);
  } catch (error) {
    console.error("csv-import authorization lookup failed", {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return refusal(
      "permission_check_failed",
      "Nu am putut verifica permisiunile.",
      500,
      origin,
    );
  }
  if (callerLevel < 6) {
    return refusal(
      "member_manage_forbidden",
      "Doar BC poate importa membri.",
      403,
      origin,
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refusal(
      "invalid_json",
      "Corp de cerere invalid (JSON).",
      400,
      origin,
    );
  }
  if (
    typeof body !== "object" || body === null || !("csv" in body) ||
    typeof body.csv !== "string"
  ) {
    return refusal("csv_required", "Câmpul csv este obligatoriu.", 400, origin);
  }
  const csv = body.csv;
  if (new TextEncoder().encode(csv).byteLength > 256 * 1024) {
    return refusal(
      "csv_too_large",
      "Fișierul CSV depășește limita de 256 KB.",
      413,
      origin,
    );
  }
  let groups: GroupReference[];
  try {
    groups = await deps.activeGroups();
  } catch (error) {
    console.error("csv-import reference load failed", {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return refusal(
      "groups_load_failed",
      "Nu am putut încărca grupurile.",
      500,
      origin,
    );
  }
  const references: RecruitCsvReferences = buildGroupLookup(groups);
  let parsed: RecruitCsvResult;
  try {
    parsed = parseRecruitsCsv(csv, references);
  } catch (error) {
    if (error instanceof ParseRecruitsCsvError) {
      return refusal(error.code, error.message, 400, origin);
    }
    // Anything else is a bug in the parser: logged, never echoed (L4).
    console.error("csv-import parse failed", error);
    return refusal(
      "unexpected_error",
      "Ceva n-a mers. Încearcă din nou.",
      500,
      origin,
    );
  }
  const recordCount = new Set([
    ...parsed.valid.map((row) => row.row),
    ...parsed.errors.map((error) => error.row),
  ]).size;
  if (recordCount > 100) {
    return refusal(
      "too_many_rows",
      "Un import poate conține cel mult 100 de membri.",
      413,
      origin,
    );
  }
  const created: Array<{ row: number; email: string; user_id: string }> = [];
  const skipped: Array<{ row: number; email: string; code: string }> = [];
  const errors: CsvImportRowError[] = [...parsed.errors];
  const seenEmails = new Set<string>();

  for (const row of parsed.valid) {
    if (seenEmails.has(row.email)) {
      skipped.push({
        row: row.row,
        email: row.email,
        code: "duplicate_in_file",
      });
      continue;
    }
    seenEmails.add(row.email);

    let result: InviteMemberResult;
    try {
      result = await deps.invite(
        {
          fullName: row.fullName,
          email: row.email,
          role: "recrut",
          groupIds: row.groupIds,
          appointedBy: callerId,
        },
        references,
      );
    } catch (error) {
      console.error("csv-import row failed", {
        row: row.row,
        errorType: error instanceof Error ? error.name : typeof error,
      });
      errors.push({
        row: row.row,
        email: row.email,
        field: "row",
        code: "unexpected_error",
        message: "Importul acestui rând a eșuat.",
      });
      continue;
    }
    if (result.kind === "created") {
      created.push({
        row: row.row,
        email: result.email,
        user_id: result.userId,
      });
    } else if (result.kind === "already_exists") {
      skipped.push({ row: row.row, email: result.email, code: result.kind });
    } else if (result.kind === "invite_failed") {
      errors.push({
        row: row.row,
        email: row.email,
        field: "row",
        code: "invite_failed",
        message: "Trimiterea invitației a eșuat.",
      });
    } else if (result.kind === "provision_failed") {
      errors.push({
        row: row.row,
        email: row.email,
        field: "row",
        code: "provision_failed",
        message: "Crearea profilului a eșuat.",
      });
    } else if (result.kind === "invalid_reference") {
      errors.push({
        row: row.row,
        email: row.email,
        field: "row",
        code: "invalid_reference",
        message: result.message,
      });
    }
  }

  return json(
    {
      summary: {
        created: created.length,
        skipped: skipped.length,
        errors: errors.length,
      },
      created,
      skipped,
      errors,
    },
    200,
    origin,
  );
}
