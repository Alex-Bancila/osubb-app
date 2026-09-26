#!/usr/bin/env node
// Production bootstrap (#112, ruling L18): the one time the service key
// provisions anyone. It creates the Moderator, then every BC/BCE Member with
// one initial Group Appointment, then imports their historical Tasks through
// the Completed Work Request commands, so private.evaluate_task writes every
// Evaluation and Points Ledger row — never a direct ledger insert.
//
// The input contract, the reasons behind each choice and what cannot be rolled
// back are in docs/backend/production-bootstrap.md. Run with --help for usage.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

// The phone rule (R8) has one TypeScript source shared with the app, which
// mirrors private.normalize_phone character for character. Node >= 24 strips
// its types on import.
import { normalizePhone } from '../app/src/lib/normalize.ts';

export const MEMBER_COLUMNS = [
  'email',
  'full_name',
  'phone',
  'role',
  'group_path',
  'group_role',
  'position_title',
  'joined_at',
  'appointed_by_email',
];

export const TASK_COLUMNS = [
  'executor_email',
  'title',
  'group_path',
  'deadline',
  'difficulty',
  'rating',
  'evaluated_at',
  'points_note',
];

/** public.roles levels; `responsabil` is retired (level 4 is no rank). */
export const ROLE_LEVELS = {
  recrut: 0,
  voluntar: 1,
  activ: 2,
  vot: 3,
  bce: 5,
  bc: 6,
  moderator: 9,
};

const GROUP_ROLES = ['member', 'manager', 'responsible'];

/** public.rating_mult: Task Points = Difficulty × this. */
export function ratingMultiplier(rating) {
  return { 1: -1, 2: 0, 3: 1, 4: 2, 5: 3 }[rating] ?? 0;
}

/** Thrown for anything the operator must fix before a single write. */
export class InputError extends Error {}

/** A PostgREST / Auth answer other than 2xx. */
export class ApiError extends Error {
  constructor(status, code, message) {
    super(`${status}${code ? ` ${code}` : ''}: ${message}`);
    this.status = status;
    this.code = code;
  }
}

// ---------------------------------------------------------------- CSV input

/**
 * RFC 4180 records with their spreadsheet row number (the header is row 1).
 * Blank lines are skipped but still counted, so a row number always matches
 * the line the operator sees in the sheet.
 */
export function parseCsv(text) {
  const source = text.replace(/^﻿/, '');
  const records = [];
  let record = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  const endRecord = () => {
    record.push(field);
    if (!(record.length === 1 && record[0].trim() === '')) {
      records.push({ row: recordLine, cells: record });
    }
    record = [];
    field = '';
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        if (c === '\n') line++;
        field += c;
      }
    } else if (c === '"' && field === '') {
      quoted = true;
    } else if (c === ',') {
      record.push(field);
      field = '';
    } else if (c === '\n') {
      endRecord();
      line++;
      recordLine = line;
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (quoted) throw new InputError(`unterminated quoted field starting on line ${recordLine}`);
  if (field !== '' || record.length > 0) endRecord();
  return records;
}

/** Rows as objects keyed by the contract's columns; the header must match exactly. */
export function readContractCsv(text, columns, fileLabel) {
  const [header, ...rows] = parseCsv(text);
  const got = header ? header.cells.map((cell) => cell.trim()) : [];
  if (got.join(',') !== columns.join(',')) {
    throw new InputError(
      `${fileLabel}: the header must be exactly\n  ${columns.join(',')}\nbut is\n  ${got.join(',')}`,
    );
  }
  return rows.map(({ row, cells }) => {
    const values = { row };
    columns.forEach((column, index) => {
      values[column] = (cells[index] ?? '').trim();
    });
    if (cells.length > columns.length && cells.slice(columns.length).some((c) => c.trim() !== '')) {
      values.extraCells = true;
    }
    return values;
  });
}

// ----------------------------------------------------------------- matching

/**
 * Case-folded, diacritic-free, whitespace-collapsed Group name. A copy of
 * normalizeGroupKey in supabase/functions/_shared/groups.ts (the csv-import
 * rule, #602), kept identical by bootstrap-production.test.mjs.
 */
export function normalizeGroupKey(value) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolves `Department` or `Department / Team / …`: each segment names an
 * active Group by short or display name, the first among every active Group,
 * each next one strictly below the previous. An unknown or ambiguous segment
 * is an error, never a guess.
 */
export function resolveGroupPath(value, groups) {
  const segments = value.split('/').map((segment) => segment.trim());
  if (segments.some((segment) => segment === '')) {
    return { error: `group_path "${value}" has an empty segment` };
  }
  let current = null;
  for (const segment of segments) {
    const key = normalizeGroupKey(segment);
    const matches = groups.filter(
      (group) =>
        (normalizeGroupKey(group.name) === key ||
          (group.short !== null && normalizeGroupKey(group.short) === key)) &&
        (current === null || (group.id !== current.id && (group.path ?? []).includes(current.id))),
    );
    if (matches.length === 0) {
      return {
        error: current
          ? `no active Group "${segment}" below "${current.name}"`
          : `no active Group "${segment}"`,
      };
    }
    if (matches.length > 1) {
      return {
        error: `"${segment}" names ${matches.length} Groups (${matches.map((g) => `${g.id} ${g.name}`).join(', ')})`,
      };
    }
    [current] = matches;
  }
  return { group: current };
}

// --------------------------------------------------------------- validation

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value) {
  if (!DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function charLength(value) {
  return Array.from(value).length;
}

/**
 * Validates both files against the contract and the target project's active
 * Groups. Returns the plan's inputs and every error at once, so one dry run
 * lists everything the sheet needs fixed.
 */
export function validateInput({ memberRows, taskRows, groups, today }) {
  const errors = [];
  const fail = (file, row, column, message) => errors.push({ file, row, column, message });
  const members = [];
  const byEmail = new Map();

  memberRows.forEach((raw, index) => {
    const at = (column, message) => fail('members', raw.row, column, message);
    if (raw.extraCells) at('row', 'more cells than the header has columns');
    const email = raw.email.toLowerCase();
    if (!EMAIL.test(email)) at('email', `"${raw.email}" is not an email address`);
    else if (byEmail.has(email)) at('email', `${email} appears twice`);

    if (raw.full_name === '') at('full_name', 'is required');

    let phone = null;
    if (raw.phone !== '') {
      phone = normalizePhone(raw.phone);
      if (phone === null) at('phone', `"${raw.phone}" is not a phone number (rule R8)`);
    }

    const role = raw.role.toLowerCase();
    if (!Object.hasOwn(ROLE_LEVELS, role)) {
      at('role', `"${raw.role}" is not a Role (${Object.keys(ROLE_LEVELS).join(', ')})`);
    } else if (index === 0 && role !== 'moderator') {
      at('role', 'the first row must be the Moderator');
    } else if (index > 0 && role === 'moderator') {
      at('role', 'only the first row may be the Moderator');
    }

    const groupRole = raw.group_role === '' ? 'member' : raw.group_role.toLowerCase();
    if (!GROUP_ROLES.includes(groupRole)) {
      at('group_role', `"${raw.group_role}" is not member, manager or responsible`);
    }
    if (groupRole === 'responsible' && raw.position_title === '') {
      at('position_title', 'a Group Responsible needs a display name');
    }
    if (groupRole !== 'responsible' && raw.position_title !== '') {
      at('position_title', 'only a Group Responsible carries a display name');
    }

    let group = null;
    if (raw.group_path === '') {
      if (index > 0) at('group_path', 'every Member after the Moderator needs a Department');
      if (groupRole !== 'member') at('group_role', 'a Group Role needs a group_path');
    } else {
      const resolved = resolveGroupPath(raw.group_path, groups);
      if (resolved.error) at('group_path', resolved.error);
      else {
        group = resolved.group;
        if (group.automatic_membership) {
          at(
            'group_path',
            `"${group.name}" follows the rank (Automatic Membership); it takes no Appointment`,
          );
        } else if (Object.hasOwn(ROLE_LEVELS, role) && ROLE_LEVELS[role] < group.min_level) {
          at('group_path', `"${group.name}" has Minimum Level ${group.min_level}, above ${role}`);
        }
      }
    }

    if (raw.joined_at !== '' && (!isRealDate(raw.joined_at) || raw.joined_at > today)) {
      at('joined_at', `"${raw.joined_at}" is not a past date YYYY-MM-DD`);
    }

    let appointedBy = null;
    const appointer = raw.appointed_by_email.toLowerCase();
    if (index === 0) {
      if (appointer !== '') at('appointed_by_email', 'the Moderator is appointed by nobody');
    } else if (appointer === '') {
      appointedBy = members[0]?.email ?? null;
    } else {
      const earlier = byEmail.get(appointer);
      if (!earlier) at('appointed_by_email', `${appointer} is not an earlier row`);
      else if (!['bc', 'moderator'].includes(earlier.role)) {
        at('appointed_by_email', `${appointer} is not BC or the Moderator`);
      } else appointedBy = appointer;
    }

    const member = {
      row: raw.row,
      email,
      fullName: raw.full_name,
      phone,
      role,
      group,
      groupRole,
      positionTitle: raw.position_title || null,
      joinedAt: raw.joined_at || null,
      appointedBy,
    };
    members.push(member);
    if (!byEmail.has(email)) byEmail.set(email, member);
  });

  const moderator = members[0];
  const firstBc = members.find((member) => member.role === 'bc');
  const tasks = [];
  for (const raw of taskRows) {
    const at = (column, message) => fail('tasks', raw.row, column, message);
    if (raw.extraCells) at('row', 'more cells than the header has columns');
    const executor = byEmail.get(raw.executor_email.toLowerCase());
    if (!executor) at('executor_email', `${raw.executor_email} is not in the members file`);

    const length = charLength(raw.title);
    if (length < 3 || length > 120) at('title', `must be 3–120 characters (is ${length})`);

    let group = null;
    const resolved = resolveGroupPath(raw.group_path, groups);
    if (raw.group_path === '') at('group_path', 'is required');
    else if (resolved.error) at('group_path', resolved.error);
    else group = resolved.group;

    // create_completed_work_request files work only in a Group where the
    // Executor holds a Group Role: their own Appointment, or anywhere below
    // it when they manage or are responsible there (private.group_role_of).
    if (executor && group && executor.group) {
      const own = group.id === executor.group.id;
      const inherited =
        executor.groupRole !== 'member' && (group.path ?? []).includes(executor.group.id);
      if (!own && !inherited) {
        at('group_path', `${executor.email} holds no Group Role in "${group.name}"`);
      }
    } else if (executor && group && !executor.group) {
      at('group_path', `${executor.email} has no Group Appointment in the members file`);
    }

    for (const column of ['deadline', 'evaluated_at']) {
      if (raw[column] !== '' && !isRealDate(raw[column])) {
        at(column, `"${raw[column]}" is not a date YYYY-MM-DD`);
      }
    }
    const difficulty = Number(raw.difficulty);
    const rating = Number(raw.rating);
    if (!/^[1-5]$/.test(raw.difficulty)) at('difficulty', `"${raw.difficulty}" is not 1–5`);
    if (!/^[1-5]$/.test(raw.rating)) at('rating', `"${raw.rating}" is not 1–5`);

    const note = evaluationNote(raw);
    if (charLength(note) > 1000)
      at('points_note', 'the Evaluation note would exceed 1000 characters');

    // A Request is never approved by its own requester: the Moderator's own
    // history is approved by the first BC in the members file.
    let approver = moderator?.email ?? null;
    if (executor && moderator && executor.email === moderator.email) {
      if (!firstBc) at('executor_email', "the Moderator's own Tasks need a BC row to approve them");
      approver = firstBc?.email ?? null;
    }

    tasks.push({
      row: raw.row,
      executor: executor?.email ?? raw.executor_email.toLowerCase(),
      title: raw.title,
      group,
      difficulty,
      rating,
      points: difficulty * ratingMultiplier(rating),
      note,
      approver,
    });
  }

  return { members, tasks, errors };
}

/** The Evaluation note every imported Task carries (shown in its history). */
export function evaluationNote(raw) {
  const parts = ['Import istoric BC/BCE (#112).'];
  if (raw.deadline) parts.push(`Termen inițial: ${raw.deadline}.`);
  if (raw.evaluated_at) parts.push(`Evaluat inițial: ${raw.evaluated_at}.`);
  if (raw.points_note) parts.push(raw.points_note);
  return parts.join(' ');
}

// -------------------------------------------------------------- HTTP client

/** Plain fetch against the project's Auth and PostgREST APIs. */
export function createApi({ url, secretKey, publishableKey, fetchImpl }) {
  const base = url.replace(/\/+$/, '');
  // Three identities: the secret key (service_role) by default, a Member's
  // session with the publishable key, or the publishable key alone (verify).
  const request = async (method, path, { body, token, anon = false, headers = {} } = {}) => {
    const auth = token
      ? { apikey: publishableKey, Authorization: `Bearer ${token}` }
      : anon
        ? { apikey: publishableKey }
        : { apikey: secretKey, Authorization: `Bearer ${secretKey}` };
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers: {
        ...auth,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let data = null;
    if (text !== '') {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!response.ok) {
      const code = data?.code ?? data?.error_code ?? data?.error ?? '';
      const message = data?.message ?? data?.msg ?? data?.error_description ?? text;
      throw new ApiError(response.status, String(code), String(message));
    }
    return { data, headers: response.headers };
  };

  return {
    async countProfiles() {
      const { headers } = await request('GET', '/rest/v1/profiles?select=id&limit=1', {
        headers: { Prefer: 'count=exact' },
      });
      const total = (headers.get('content-range') ?? '').split('/')[1];
      const count = Number(total);
      if (!Number.isInteger(count)) throw new ApiError(500, '', 'profiles count unreadable');
      return count;
    },
    async activeGroups() {
      const all = [];
      for (let offset = 0; ; offset += 1000) {
        const { data } = await request(
          'GET',
          '/rest/v1/groups?select=id,name,short,path,min_level,automatic_membership' +
            `&status=eq.active&order=id&limit=1000&offset=${offset}`,
        );
        all.push(...data);
        if (data.length < 1000) return all;
      }
    },
    async authEmails() {
      const emails = new Set();
      for (let page = 1; ; page++) {
        const { data } = await request('GET', `/auth/v1/admin/users?page=${page}&per_page=1000`);
        const users = data?.users ?? [];
        users.forEach((user) => user.email && emails.add(user.email.toLowerCase()));
        if (users.length < 1000) return emails;
      }
    },
    async profilesByEmail(emails) {
      const list = emails.map((email) => `"${email}"`).join(',');
      const { data } = await request(
        'GET',
        `/rest/v1/profiles?select=id,email,role&email=in.(${encodeURIComponent(list)})`,
      );
      return data;
    },
    async createUser(email) {
      const { data } = await request('POST', '/auth/v1/admin/users', {
        body: { email, email_confirm: true },
      });
      return data.id;
    },
    async deleteUser(id) {
      await request('DELETE', `/auth/v1/admin/users/${id}`);
    },
    async rpc(name, args, token) {
      const { data } = await request('POST', `/rest/v1/rpc/${name}`, { body: args, token });
      return data;
    },
    async patchProfile(id, fields) {
      await request('PATCH', `/rest/v1/profiles?id=eq.${id}`, {
        body: fields,
        headers: { Prefer: 'return=minimal' },
      });
    },
    async session(email) {
      const { data: link } = await request('POST', '/auth/v1/admin/generate_link', {
        body: { type: 'magiclink', email },
      });
      const tokenHash = link?.hashed_token ?? link?.properties?.hashed_token;
      if (!tokenHash) throw new ApiError(500, '', `generate_link gave no token for ${email}`);
      const { data: session } = await request('POST', '/auth/v1/verify', {
        body: { type: link?.verification_type ?? 'magiclink', token_hash: tokenHash },
        anon: true,
      });
      if (!session?.access_token) throw new ApiError(500, '', `no session for ${email}`);
      return session.access_token;
    },
    async signOut(token) {
      await request('POST', '/auth/v1/logout?scope=local', { token });
    },
  };
}

// --------------------------------------------------------------------- plan

/**
 * Every write the run makes, in order. A dry run prints `describe`; the real
 * run calls `run`. `reversible` is false from the first Task write on: from
 * there a failure stops without rolling anything back.
 */
export function buildPlan({ members, tasks, resumeFrom }) {
  const steps = [];
  const moderator = members[0];
  const id = (ctx, email) => ctx.ids.get(email) ?? `<id of ${email}>`;
  const importing = resumeFrom === null ? tasks : tasks.filter((task) => task.row >= resumeFrom);

  if (resumeFrom === null) {
    for (const member of members) {
      const label = member === moderator ? ' (Moderator)' : '';
      steps.push({
        reversible: true,
        describe: () =>
          `auth: create user ${member.email}, email confirmed, no email sent — members row ${member.row}${label}`,
        run: async (ctx) => {
          ctx.ids.set(member.email, await ctx.api.createUser(member.email));
          ctx.created.push(member.email);
        },
      });
      const args = (ctx) => ({
        p_user_id: id(ctx, member.email),
        p_full_name: member.fullName,
        p_email: member.email,
        p_role: member.role,
        p_group_ids: member.group ? [member.group.id] : [],
        p_appointed_by: member.appointedBy ? id(ctx, member.appointedBy) : null,
      });
      steps.push({
        reversible: true,
        describe: (ctx) =>
          `rpc provision_profile ${JSON.stringify(args(ctx))}` +
          (member.group ? ` — Appointment in ${member.group.name}` : ''),
        run: async (ctx) => {
          await ctx.api.rpc('provision_profile', args(ctx));
          ctx.summary.members.push(member);
        },
      });
      const fields = {};
      if (member.phone) fields.phone = member.phone;
      if (member.joinedAt) fields.joined_at = member.joinedAt;
      if (Object.keys(fields).length > 0) {
        steps.push({
          reversible: true,
          describe: (ctx) => `patch profiles ${id(ctx, member.email)} ${JSON.stringify(fields)}`,
          run: (ctx) => ctx.api.patchProfile(id(ctx, member.email), fields),
        });
      }
    }
  }

  const positions = resumeFrom === null ? members.filter((m) => m.groupRole !== 'member') : [];
  const sessionEmails = [];
  const needSession = (email) =>
    email && !sessionEmails.includes(email) && sessionEmails.push(email);
  if (positions.length > 0) needSession(moderator.email);
  for (const task of importing) {
    needSession(task.approver);
    needSession(task.executor);
  }
  for (const email of sessionEmails) {
    steps.push({
      reversible: true,
      describe: () =>
        `auth: session for ${email} (admin generate_link magiclink + verify; no email sent)`,
      run: async (ctx) => {
        ctx.tokens.set(email, await ctx.api.session(email));
      },
    });
  }

  for (const member of positions) {
    const args = (ctx) => ({
      p_group_id: member.group.id,
      p_member_id: id(ctx, member.email),
      p_group_role: member.groupRole,
      p_position_title: member.positionTitle,
    });
    steps.push({
      reversible: true,
      describe: (ctx) =>
        `as ${moderator.email}: rpc set_group_role ${JSON.stringify(args(ctx))} — ${member.group.name}`,
      run: async (ctx) => {
        await ctx.api.rpc('set_group_role', args(ctx), ctx.tokens.get(moderator.email));
        ctx.summary.positions += 1;
      },
    });
  }

  for (const task of importing) {
    const requestArgs = { p_description: task.title, p_group_id: task.group.id };
    steps.push({
      reversible: false,
      describe: () =>
        `as ${task.executor}: rpc create_completed_work_request ${JSON.stringify(requestArgs)} — tasks row ${task.row}`,
      run: async (ctx) => {
        ctx.pending = { row: task.row, request: null };
        const request = await ctx.api.rpc(
          'create_completed_work_request',
          requestArgs,
          ctx.tokens.get(task.executor),
        );
        ctx.pending.request = request.id;
      },
    });
    const approveArgs = (ctx) => ({
      p_request_id: ctx.pending?.request ?? `<request of tasks row ${task.row}>`,
      p_difficulty: task.difficulty,
      p_rating: task.rating,
      p_note: task.note,
    });
    steps.push({
      reversible: false,
      describe: (ctx) =>
        `as ${task.approver}: rpc approve_completed_work_request ${JSON.stringify(approveArgs(ctx))} → ${task.points} Task Points`,
      run: async (ctx) => {
        await ctx.api.rpc(
          'approve_completed_work_request',
          approveArgs(ctx),
          ctx.tokens.get(task.approver),
        );
        ctx.pending = null;
        ctx.summary.tasks.push(task);
      },
    });
  }

  return { steps, sessionEmails };
}

// --------------------------------------------------------------------- main

const USAGE = `Usage:
  node scripts/bootstrap-production.mjs --members <members.csv> [--tasks <tasks.csv>] --dry-run
  node scripts/bootstrap-production.mjs --members <members.csv> [--tasks <tasks.csv>] --execute
  node scripts/bootstrap-production.mjs --members <members.csv> --tasks <tasks.csv> --execute --resume-tasks-from <row>

Environment:
  SUPABASE_URL              https://<project-ref>.supabase.co (or http://127.0.0.1:54321)
  SUPABASE_SECRET_KEY       the project's secret key, sb_secret_… (never the legacy service_role JWT)
  SUPABASE_PUBLISHABLE_KEY  the publishable key (or legacy anon key); needed by --execute

The contract, and what cannot be rolled back: docs/backend/production-bootstrap.md`;

export async function main(argv, { env, fetchImpl, log, readFile, now = new Date() }) {
  let options;
  try {
    ({ values: options } = parseArgs({
      args: argv,
      options: {
        members: { type: 'string' },
        tasks: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        execute: { type: 'boolean', default: false },
        'resume-tasks-from': { type: 'string' },
        help: { type: 'boolean', default: false },
      },
      strict: true,
    }));
  } catch (error) {
    log(`${error.message}\n\n${USAGE}`);
    return 2;
  }
  if (options.help) {
    log(USAGE);
    return 0;
  }
  const dryRun = options['dry-run'];
  if (dryRun === options.execute || !options.members) {
    log(`Give --members and exactly one of --dry-run or --execute.\n\n${USAGE}`);
    return 2;
  }
  let resumeFrom = null;
  if (options['resume-tasks-from'] !== undefined) {
    resumeFrom = Number(options['resume-tasks-from']);
    if (!Number.isInteger(resumeFrom) || resumeFrom < 2 || !options.tasks) {
      log('--resume-tasks-from takes a tasks row number (2 or more) and needs --tasks.');
      return 2;
    }
  }

  const url = env.SUPABASE_URL ?? '';
  const secretKey = env.SUPABASE_SECRET_KEY ?? '';
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY ?? '';
  // The secret key travels on every request, so plain http is for the local
  // stack only.
  let parsedUrl = null;
  try {
    parsedUrl = new URL(url);
  } catch {
    parsedUrl = null;
  }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(parsedUrl?.hostname ?? '');
  if (
    !parsedUrl ||
    !(parsedUrl.protocol === 'https:' || (parsedUrl.protocol === 'http:' && loopback))
  ) {
    log('SUPABASE_URL must be the https:// project URL (http:// only for a local stack).');
    return 2;
  }
  if (!secretKey.startsWith('sb_secret_')) {
    log(
      "SUPABASE_SECRET_KEY must be the project's secret key (sb_secret_…); the legacy service_role key is not read (ruling L8).",
    );
    return 2;
  }
  if (!dryRun && publishableKey === '') {
    log(
      'SUPABASE_PUBLISHABLE_KEY is required for --execute (the Task commands run in Member sessions).',
    );
    return 2;
  }

  let memberRows;
  let taskRows = [];
  try {
    memberRows = readContractCsv(readFile(options.members), MEMBER_COLUMNS, options.members);
    if (options.tasks)
      taskRows = readContractCsv(readFile(options.tasks), TASK_COLUMNS, options.tasks);
  } catch (error) {
    log(error instanceof InputError ? error.message : `cannot read input: ${error.message}`);
    return 2;
  }
  if (memberRows.length === 0) {
    log(`${options.members} has no Member rows.`);
    return 2;
  }

  const api = createApi({ url, secretKey, publishableKey, fetchImpl });
  const mode = dryRun
    ? 'DRY RUN — no writes'
    : resumeFrom !== null
      ? `RESUME from tasks row ${resumeFrom}`
      : 'REAL RUN';
  log(`Production bootstrap (#112) against ${new URL(url).host} — ${mode}`);

  // ------------------------------------------------ preflight: reads only
  let groups;
  const ctx = {
    api,
    ids: new Map(),
    tokens: new Map(),
    created: [],
    pending: null,
    summary: { members: [], positions: 0, tasks: [] },
  };
  try {
    const profiles = await api.countProfiles();
    if (resumeFrom === null && profiles > 0) {
      const message = `PT409 bootstrap_refused: ${profiles} profile(s) already exist; the bootstrap runs only against a project with none.`;
      if (!dryRun) {
        log(message);
        return 1;
      }
      log(`warning: the real run would stop here — ${message}`);
    }
    groups = await api.activeGroups();
    if (resumeFrom === null) {
      const taken = await api.authEmails();
      const clashes = memberRows
        .map((row) => row.email.toLowerCase())
        .filter((email) => taken.has(email));
      if (clashes.length > 0) {
        const message = `PT409 bootstrap_refused: Auth already has ${clashes.join(', ')}.`;
        if (!dryRun) {
          log(message);
          return 1;
        }
        log(`warning: the real run would stop here — ${message}`);
      }
    }
  } catch (error) {
    log(`preflight failed, nothing was written: ${error.message}`);
    return 1;
  }

  const { members, tasks, errors } = validateInput({
    memberRows,
    taskRows,
    groups,
    today: now.toISOString().slice(0, 10),
  });
  if (resumeFrom !== null && !tasks.some((task) => task.row === resumeFrom)) {
    errors.push({
      file: 'tasks',
      row: resumeFrom,
      column: 'row',
      message: 'no such tasks row to resume from',
    });
  }
  if (errors.length > 0) {
    for (const error of errors)
      log(`error: ${error.file} row ${error.row}, ${error.column}: ${error.message}`);
    log(`${errors.length} input error(s); nothing was written.`);
    return 2;
  }

  if (resumeFrom !== null) {
    try {
      const existing = await api.profilesByEmail(members.map((member) => member.email));
      for (const profile of existing) ctx.ids.set(profile.email, profile.id);
      const missing = members.filter((member) => !ctx.ids.has(member.email));
      if (missing.length > 0) {
        log(
          `--resume-tasks-from needs every Member to exist; missing: ${missing.map((m) => m.email).join(', ')}`,
        );
        return 1;
      }
    } catch (error) {
      log(`preflight failed, nothing was written: ${error.message}`);
      return 1;
    }
  }

  const { steps, sessionEmails } = buildPlan({ members, tasks, resumeFrom });

  if (dryRun) {
    steps.forEach((step, index) => log(`[${index + 1}/${steps.length}] ${step.describe(ctx)}`));
    sessionEmails.forEach((email) => log(`[after] auth: sign out the session of ${email}`));
    printTotals(
      log,
      members,
      tasks.filter((task) => resumeFrom === null || task.row >= resumeFrom),
      'would',
    );
    return 0;
  }

  // ----------------------------------------------------------- real run
  let failure = null;
  let failedAt = null;
  for (const [index, step] of steps.entries()) {
    log(`[${index + 1}/${steps.length}] ${step.describe(ctx)}`);
    try {
      await step.run(ctx);
    } catch (error) {
      failure = error;
      failedAt = step;
      log(`FAILED: ${error.message}`);
      break;
    }
  }

  for (const email of sessionEmails) {
    const token = ctx.tokens.get(email);
    if (!token) continue;
    try {
      await api.signOut(token);
      log(`auth: signed out ${email}`);
    } catch (error) {
      log(
        `warning: could not sign out ${email} (${error.message}); the session expires on its own`,
      );
    }
  }

  if (failure === null) {
    printTotals(log, ctx.summary.members, ctx.summary.tasks, 'did');
    log(`Group Roles set: ${ctx.summary.positions}.`);
    log('Bootstrap complete.');
    return 0;
  }

  // An ApiError is an answer: the call was refused and wrote nothing. Anything
  // else (a reset connection, a timeout) leaves the last call's outcome unknown.
  const noAnswer = !(failure instanceof ApiError);
  if (noAnswer && failedAt.reversible) {
    log(
      'The last call got no answer, so it may have written. A new run refuses in its preflight ' +
        'if it did; then delete that user in Authentication → Users.',
    );
  }
  if (failedAt.reversible && ctx.created.length === 0) {
    log(noAnswer ? 'Nothing else was written.' : 'Nothing was written.');
    return 1;
  }
  if (failedAt.reversible) {
    log(
      `Rolling back: deleting the ${ctx.created.length} Auth user(s) this run created (their profiles, Appointments and Notifications cascade).`,
    );
    const left = [];
    for (const email of [...ctx.created].reverse()) {
      try {
        await api.deleteUser(ctx.ids.get(email));
        log(`auth: deleted ${email}`);
      } catch (error) {
        left.push(email);
        log(`ROLLBACK FAILED for ${email}: ${error.message}`);
      }
    }
    log(
      left.length === 0
        ? 'Rolled back: the project has no profile from this run; fix the cause and run again.'
        : `NOT rolled back: ${left.join(', ')} — delete them in Authentication → Users before running again.`,
    );
    return 1;
  }

  const done = ctx.summary.tasks.map((task) => task.row);
  log(
    `Stopped in the Task import; Members and imported Tasks stay (Tasks, Evaluations and Points Ledger rows cannot be deleted).`,
  );
  log(`Tasks rows imported: ${done.length > 0 ? done.join(', ') : 'none'}.`);
  const resume = (row) =>
    `node scripts/bootstrap-production.mjs --members ${options.members} --tasks ${options.tasks} ` +
    `--execute --resume-tasks-from ${row}`;
  const pending = ctx.pending;
  const following = pending ? nextRow(tasks, pending.row) : null;
  const approveHint = "approve it if it is still pending, with the row's Difficulty and Rating";
  if (pending?.request && noAnswer) {
    // The Request exists; only its status is unknown. Resuming from this row
    // would file a second one, and an approved Task cannot be deleted.
    log(
      `tasks row ${pending.row}: Request ${pending.request} was filed, but its approval got no answer ` +
        `(${failure.message}). Open Request ${pending.request} in Administrare → Cereri: if it is still ` +
        `pending, approve it with the row's Difficulty and Rating; if it is approved, do nothing. ` +
        `Never resume from row ${pending.row}.`,
    );
    if (following !== null) log(`Then resume with: ${resume(following)}`);
  } else if (pending && noAnswer) {
    log(
      `tasks row ${pending.row}: the server gave no answer (${failure.message}), so the outcome is ` +
        `unknown. Check Administrare → Cereri for this row's Request before resuming.`,
    );
    log(`If it is not there, resume with: ${resume(pending.row)}`);
    log(
      following === null
        ? `If it is there: ${approveHint}; that was the last row.`
        : `If it is there: ${approveHint}, then resume with: ${resume(following)}`,
    );
  } else if (pending?.request) {
    log(
      `tasks row ${pending.row} left Request ${pending.request} pending: approve it in the app ` +
        `(Administrare → Cereri) with the row's Difficulty and Rating, then resume from the next row.`,
    );
    if (following !== null) log(`Resume with: ${resume(following)}`);
  } else if (pending) {
    log(`tasks row ${pending.row} wrote nothing.`);
    log(`Resume with: ${resume(pending.row)}`);
  }
  return 1;
}

function nextRow(tasks, row) {
  return tasks.find((task) => task.row > row)?.row ?? null;
}

function printTotals(log, members, tasks, verb) {
  const moderators = members.filter((member) => member.role === 'moderator').length;
  log(
    `Summary: ${verb === 'would' ? 'would create' : 'created'} ${members.length} Member(s) ` +
      `(${moderators} Moderator), ${verb === 'would' ? 'would import' : 'imported'} ${tasks.length} Task(s).`,
  );
  const points = new Map();
  for (const task of tasks)
    points.set(task.executor, (points.get(task.executor) ?? 0) + task.points);
  for (const [email, total] of points) log(`  ${email}: ${total} Task Points`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main(process.argv.slice(2), {
    env: process.env,
    fetchImpl: fetch,
    log: (line) => console.log(line),
    readFile: (path) => readFileSync(path, 'utf8'),
  });
}
