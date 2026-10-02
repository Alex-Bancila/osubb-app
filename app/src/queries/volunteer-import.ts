import { skipToken, useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { CommandError } from '../lib/command-reasons';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

/*
 * The volunteer-base import (#991) as the Membri screens (#992) use it.
 *
 * Every shape the backend answers is read HERE and nowhere else: the dialog,
 * the "De invitat" grid and the sender only see the types below. When
 * `csv-import`, `send-invitations` or `uninvited_members()` rename a field,
 * this is the one file that changes with them. Each reader is lenient — a
 * missing field reads as empty, never as a crash — and strict about what
 * decides an action (a row's blocking problems, a send's status).
 */

/* ------------------------------------------------------------- the file */

/** The sheet's header (#991): what tells the volunteer format from the old one. */
const VOLUNTEER_HEADER = /nume\s*&\s*prenume/i;

/** True when the file is the volunteer sheet rather than `name,email,dept,team`. */
export function isVolunteerSheet(csv: string): boolean {
  const header = csv.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
  return VOLUNTEER_HEADER.test(header);
}

/** How many sheet rows one apply request names (`rows`; the function takes 100). */
export const IMPORT_CHUNK = 50;

/* ------------------------------------------------------------ the shapes */

export type GroupRole = 'manager' | 'responsible' | 'member';

/** One Group a row places the Member in, in the sheet's (= roster's) order. */
export type Placement = {
  groupId: number;
  groupName: string;
  groupRole: GroupRole;
  positionTitle: string | null;
};

/**
 * What the import says about one row. A `blocking` problem (no address, an
 * unknown Department, a duplicate) keeps the row out; the others are notes
 * the row imports with (a missing Project, a BCE without a position).
 */
export type ImportProblem = {
  code: string;
  message: string;
  blocking: boolean;
};

/** One sheet row as the dry run plans it. */
export type PreviewRow = {
  row: number;
  name: string;
  email: string;
  /** The Role key (`voluntar`, `vot`, `bce`, `bc`). */
  rank: string;
  /** `complete`: the address was imported before; the re-run fills the gaps. */
  action: 'create' | 'complete' | 'skip';
  placements: Placement[];
  problems: ImportProblem[];
};

export type ImportPreview = {
  rows: PreviewRow[];
  /** Rows with no problem at all. */
  ok: number;
  /** Rows with at least one problem, blocking or not. */
  withProblems: number;
  /** Rows the apply creates or completes. */
  importable: number;
};

export type ImportRowOutcome = 'created' | 'completed' | 'skipped' | 'failed';

export type ImportResult = {
  created: number;
  completed: number;
  skipped: number;
  failed: number;
  rows: Array<{
    row: number;
    email: string;
    outcome: ImportRowOutcome;
    message: string | null;
  }>;
};

/** A Member nobody has invited and who never signed in (`uninvited_members()`). */
export type UninvitedMember = {
  memberId: string;
  name: string;
  email: string;
  phone: string | null;
  /** The Role key (`voluntar`, `bc` …). */
  role: string | null;
  /** Explicit roster rows, earliest first: the first top-level one is the chip (R17). */
  groups: Placement[];
  /** The import's notes for BC; never blocking — the Member exists. */
  problems: ImportProblem[];
};

/**
 * One Member's send (#991): `skipped` had nothing to send (signed in since,
 * confirmed, inactive), `failed` was refused by Auth while the batch went on,
 * `rate_limited` stopped the batch there, and `not_attempted` came after a
 * stop (the limit, or the function's own time budget).
 */
export type SendStatus =
  'sent' | 'skipped' | 'failed' | 'rate_limited' | 'not_attempted';

/** The sender's own ceiling per call (`BATCH_LIMIT`). */
export const SEND_BATCH_LIMIT = 50;

export type SendResult = {
  results: Array<{
    memberId: string;
    status: SendStatus;
    invitedAt: string | null;
    message: string | null;
  }>;
  /** True when Auth's email rate limit stopped the batch part-way. */
  rateLimited: boolean;
};

/* ----------------------------------------------------------- the readers */

type Json = Record<string, unknown>;

function record(value: unknown): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(...values: unknown[]): string {
  for (const value of values) if (typeof value === 'string') return value;
  return '';
}

function maybeText(...values: unknown[]): string | null {
  for (const value of values)
    if (typeof value === 'string' && value.trim()) return value;
  return null;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function readGroupRole(value: unknown): GroupRole {
  return value === 'manager' || value === 'responsible' ? value : 'member';
}

function readPlacement(value: unknown): Placement {
  const row = record(value);
  return {
    groupId: count(row.group_id),
    groupName: text(row.group_name, row.name),
    groupRole: readGroupRole(row.group_role),
    positionTitle: maybeText(row.position_title),
  };
}

/** `{code, message, blocking}`; a bare string is a note (the grid's `text[]`). */
function readProblem(value: unknown): ImportProblem {
  if (typeof value === 'string')
    return { code: 'note', message: value, blocking: false };
  const problem = record(value);
  const code = text(problem.code);
  return {
    code,
    message: text(problem.message, code),
    blocking: problem.blocking === true,
  };
}

const ACTIONS: ReadonlySet<string> = new Set(['create', 'complete', 'skip']);

export function readPreview(data: unknown): ImportPreview {
  const rows = list(record(data).rows).map((value): PreviewRow => {
    const row = record(value);
    const action = text(row.action);
    return {
      row: count(row.row),
      name: text(row.full_name),
      email: text(row.email),
      rank: text(row.rank),
      action: (ACTIONS.has(action) ? action : 'skip') as PreviewRow['action'],
      placements: list(row.placements).map(readPlacement),
      problems: list(row.problems).map(readProblem),
    };
  });
  const withProblems = rows.filter((row) => row.problems.length > 0).length;
  const importable = rows.filter(
    (row) =>
      row.action !== 'skip' &&
      !row.problems.some((problem) => problem.blocking),
  ).length;
  return {
    rows,
    ok: rows.length - withProblems,
    withProblems,
    importable,
  };
}

const OUTCOMES: ReadonlySet<string> = new Set([
  'created',
  'completed',
  'skipped',
  'failed',
]);

export function readImportResult(data: unknown): ImportResult {
  const rows = list(record(data).rows).map((value) => {
    const row = record(value);
    const outcome = text(row.outcome);
    return {
      row: count(row.row),
      email: text(row.email),
      outcome: (OUTCOMES.has(outcome) ? outcome : 'failed') as ImportRowOutcome,
      message: maybeText(row.message),
    };
  });
  const tally = (outcome: ImportRowOutcome) =>
    rows.filter((row) => row.outcome === outcome).length;
  return {
    created: tally('created'),
    completed: tally('completed'),
    skipped: tally('skipped'),
    failed: tally('failed'),
    rows,
  };
}

const SEND_STATUSES: ReadonlySet<string> = new Set([
  'sent',
  'skipped',
  'failed',
  'rate_limited',
  'not_attempted',
]);

/** `send-invitations`' answer; an unknown status is never read as sent. */
export function readSendResult(data: unknown): SendResult {
  const body = record(data);
  const results = list(body.results).map((value) => {
    const row = record(value);
    const raw = text(row.status);
    return {
      memberId: text(row.member_id),
      status: (SEND_STATUSES.has(raw) ? raw : 'failed') as SendStatus,
      invitedAt: maybeText(row.invited_at),
      message: maybeText(row.message),
    };
  });
  const stopped = record(body.stopped);
  return {
    results,
    rateLimited:
      stopped.reason === 'rate_limited' ||
      results.some((row) => row.status === 'rate_limited'),
  };
}

export function readUninvited(data: unknown): UninvitedMember[] {
  return list(data).map((value) => {
    const row = record(value);
    return {
      memberId: text(row.member_id),
      name: text(row.full_name),
      email: text(row.email),
      phone: maybeText(row.phone),
      role: maybeText(row.role),
      groups: list(row.memberships).map(readPlacement),
      problems: list(row.problems).map(readProblem),
    };
  });
}

/* ---------------------------------------------------------- the requests */

/**
 * An Edge Function refusal answers `{ error, code }`; `error` is the
 * function's own Romanian. A gateway error has no body: the fallback.
 */
async function functionFailure(error: unknown, fallback: string) {
  if (typeof error === 'object' && error !== null && 'context' in error) {
    const context = error.context;
    if (context instanceof Response) {
      try {
        const message = maybeText(record(await context.clone().json()).error);
        if (message) return new Error(message);
      } catch {
        // No JSON body: the fallback below.
      }
    }
  }
  return new Error(fallback);
}

export const PREVIEW_FAILED =
  'Nu am putut verifica fișierul. Verifică fișierul și reîncearcă.';
export const IMPORT_FAILED =
  'Lotul nu s-a putut importa. Importă din nou fișierul: rândurile deja create nu se dublează.';
export const SEND_FAILED =
  'Nu am putut trimite acest lot. Verifică internetul și reia trimiterea.';

/** The dry run: the plan for every row; nothing created, nothing sent. */
export async function previewVolunteerImport(
  csv: string,
): Promise<ImportPreview> {
  const result = await supabase.functions.invoke('csv-import', {
    body: { csv, mode: 'dry_run' },
  });
  if (result.error) throw await functionFailure(result.error, PREVIEW_FAILED);
  return readPreview(result.data);
}

/**
 * Creates the accounts the preview showed, sending no email (#991): the whole
 * file each time, with `rows` naming `IMPORT_CHUNK` sheet rows per request,
 * so progress counts real rows and no request runs into the function's time
 * limit. A refused chunk marks its own rows as failed and the rest still go;
 * importing the file again completes exactly those (never a second account).
 */
export async function applyVolunteerImport(
  csv: string,
  rows: readonly number[],
  onProgress?: (done: number, total: number) => void,
): Promise<ImportResult> {
  const total: ImportResult = {
    created: 0,
    completed: 0,
    skipped: 0,
    failed: 0,
    rows: [],
  };
  onProgress?.(0, rows.length);
  for (let from = 0; from < rows.length; from += IMPORT_CHUNK) {
    const chunk = rows.slice(from, from + IMPORT_CHUNK);
    const result = await supabase.functions.invoke('csv-import', {
      body: { csv, mode: 'apply', rows: chunk },
    });
    const part = result.error
      ? chunkFailure(
          chunk,
          (await functionFailure(result.error, IMPORT_FAILED)).message,
        )
      : readImportResult(result.data);
    total.created += part.created;
    total.completed += part.completed;
    total.skipped += part.skipped;
    total.failed += part.failed;
    total.rows.push(...part.rows);
    onProgress?.(Math.min(from + chunk.length, rows.length), rows.length);
  }
  return total;
}

function chunkFailure(rows: readonly number[], message: string): ImportResult {
  return {
    created: 0,
    completed: 0,
    skipped: 0,
    failed: rows.length,
    rows: rows.map((row) => ({
      row,
      email: '',
      outcome: 'failed' as const,
      message,
    })),
  };
}

/** One batch through the backend sender; it stamps `invited_at` per sent Member. */
export async function sendInvitationBatch(
  memberIds: readonly string[],
): Promise<SendResult> {
  const result = await supabase.functions.invoke('send-invitations', {
    body: { member_ids: [...memberIds] },
  });
  if (result.error) throw await functionFailure(result.error, SEND_FAILED);
  return readSendResult(result.data);
}

export async function fetchUninvitedMembers(): Promise<UninvitedMember[]> {
  const { data, error } = await supabase.rpc('uninvited_members');
  if (error) throw error;
  return readUninvited(data);
}

/** BC and the Moderator only: the read refuses everyone else (42501). */
export function useUninvitedMembers(enabled = true) {
  const viewerId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.members.uninvited(viewerId),
    queryFn: viewerId && enabled ? fetchUninvitedMembers : skipToken,
  });
}

/* ------------------------------------------------------- the grid's edits */

export type ContactField = 'fullName' | 'email' | 'phone';

const CONTACT_COLUMN = {
  fullName: 'full_name',
  email: 'email',
  phone: 'phone',
} as const;

/**
 * One contact cell of a never-invited Member: the `profiles` column a live BC
 * or Moderator may write on any row (#944; `email` is BC's alone). The sender
 * mails the Profile's address, moving the unused Auth account to it first
 * (#997), so a corrected one is where the invitation goes. `.single()` turns
 * an RLS refusal (zero rows) into a failure; an address another profile holds
 * (the unique `profiles.email`) reads as `email_taken`.
 */
export async function updateUninvitedContact(input: {
  memberId: string;
  field: ContactField;
  value: string | null;
}) {
  const { error } = await supabase
    .from('profiles')
    .update({ [CONTACT_COLUMN[input.field]]: input.value } as never)
    .eq('id', input.memberId)
    .select('id')
    .single();
  if (error)
    throw new CommandError(
      input.field === 'email' && error.code === '23505'
        ? { message: 'email_taken' }
        : error,
      'Nu am putut salva schimbarea.',
    );
}
