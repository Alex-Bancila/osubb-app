// node:test suite for scripts/bootstrap-production.mjs (#112). Every call goes
// to an in-memory fake of the Auth and PostgREST APIs, so nothing here needs a
// database; the fake records each request so a test can assert what was (and
// was not) written, and in which order.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { normalizeGroupKey as denoNormalizeGroupKey } from '../supabase/functions/_shared/groups.ts';
import {
  main,
  normalizeGroupKey,
  parseCsv,
  readContractCsv,
  MEMBER_COLUMNS,
  TASK_COLUMNS,
  validateInput,
} from './bootstrap-production.mjs';

const MEMBERS_FILE = 'docs/backend/production-bootstrap-members.example.csv';
const TASKS_FILE = 'docs/backend/production-bootstrap-tasks.example.csv';

const GROUPS = [
  { id: 2, name: 'Tineret', short: 'TIN', path: [2], min_level: 0, automatic_membership: false },
  { id: 6, name: 'Diverse', short: 'DIV', path: [6], min_level: 0, automatic_membership: false },
  {
    id: 7,
    name: 'Secretariat',
    short: 'SEC',
    path: [7],
    min_level: 0,
    automatic_membership: false,
  },
  {
    id: 8,
    name: 'Educațional',
    short: 'EDU',
    path: [8],
    min_level: 0,
    automatic_membership: false,
  },
  {
    id: 9,
    name: 'Echipa IT',
    short: null,
    path: [6, 9],
    min_level: 0,
    automatic_membership: false,
  },
  {
    id: 10,
    name: 'Echipa IT',
    short: null,
    path: [8, 10],
    min_level: 0,
    automatic_membership: false,
  },
  {
    id: 62,
    name: 'Adunarea Generală',
    short: null,
    path: [62],
    min_level: 3,
    automatic_membership: true,
  },
];

const ENV = {
  SUPABASE_URL: 'https://example-ref.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
};

/**
 * An in-memory project: `profiles` existing rows, `authEmails` taken addresses,
 * `fail` injects a refusal (an answer), `drop` a lost connection (no answer).
 */
function fakeProject({
  profiles = [],
  authEmails = [],
  fail = () => false,
  drop = () => false,
} = {}) {
  const calls = [];
  let requestId = 100;
  const json = (status, body, headers = {}) =>
    new Response(body === null ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  const fetchImpl = async (url, init) => {
    const { pathname, searchParams } = new URL(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    const call = {
      method: init.method,
      path: pathname,
      query: searchParams,
      body,
      headers: init.headers,
    };
    calls.push(call);
    if (drop(call)) throw new TypeError('fetch failed');
    if (fail(call)) return json(400, { code: 'PT400', message: 'group_archived' });
    const route = `${init.method} ${pathname}`;
    switch (route) {
      case 'GET /rest/v1/profiles':
        if (searchParams.has('email')) return json(200, profiles);
        return json(200, [], {
          'content-range': profiles.length ? `0-0/${profiles.length}` : '*/0',
        });
      case 'GET /rest/v1/groups':
        return json(200, searchParams.get('offset') === '0' ? GROUPS : []);
      case 'GET /auth/v1/admin/users':
        return json(200, { users: authEmails.map((email) => ({ email })) });
      case 'POST /auth/v1/admin/users':
        return json(200, { id: `uid:${body.email}` });
      case 'POST /rest/v1/rpc/provision_profile':
        return json(200, body.p_user_id);
      case 'PATCH /rest/v1/profiles':
        return json(204, null);
      case 'POST /auth/v1/admin/generate_link':
        return json(200, { hashed_token: `hash:${body.email}`, verification_type: 'magiclink' });
      case 'POST /auth/v1/verify':
        return json(200, { access_token: `jwt:${body.token_hash.slice(5)}` });
      case 'POST /rest/v1/rpc/set_group_role':
        return json(200, { group_id: body.p_group_id });
      case 'POST /rest/v1/rpc/create_completed_work_request':
        return json(200, { id: ++requestId, status: 'pending' });
      case 'POST /rest/v1/rpc/approve_completed_work_request':
        return json(200, { id: body.p_request_id, status: 'approved' });
      case 'POST /auth/v1/logout':
        return json(204, null);
      default:
        if (init.method === 'DELETE' && pathname.startsWith('/auth/v1/admin/users/'))
          return json(200, {});
        return json(404, { message: `unexpected ${route}` });
    }
  };
  const writes = () => calls.filter((call) => call.method !== 'GET');
  return { fetchImpl, calls, writes };
}

async function run(args, project, { files = {} } = {}) {
  const lines = [];
  const code = await main(args, {
    env: ENV,
    fetchImpl: project.fetchImpl,
    log: (line) => lines.push(line),
    readFile: (path) => files[path] ?? readFileSync(path, 'utf8'),
    now: new Date('2026-10-02T06:00:00Z'),
  });
  return { code, lines, output: lines.join('\n') };
}

const BOTH = ['--members', MEMBERS_FILE, '--tasks', TASKS_FILE];
const bearer = (call) => call.headers.Authorization;

// ------------------------------------------------------------------ dry run

test('a dry run prints every call of the real run, in order, and writes nothing', async () => {
  const project = fakeProject();
  const { code, lines } = await run([...BOTH, '--dry-run'], project);

  assert.equal(code, 0);
  assert.deepEqual(project.writes(), [], 'a dry run makes no write');
  const plan = lines.filter((line) => /^\[\d+\/\d+\]/.test(line));
  assert.match(plan[0], /create user moderator@example\.com.*members row 2 \(Moderator\)/);
  assert.match(
    plan[1],
    /rpc provision_profile .*"p_role":"moderator","p_group_ids":\[9\],"p_appointed_by":null/,
  );
  assert.match(
    plan[2],
    /patch profiles <id of moderator@example\.com> \{"phone":"\+40730655145","joined_at":"2023-10-01"\}/,
  );
  // Everyone after the Moderator is appointed by the Moderator unless the row names a BC.
  const provisions = plan.filter((line) => line.includes('provision_profile'));
  assert.equal(provisions.length, 5);
  assert.match(
    provisions[2],
    /"p_email":"bce\.edu@example\.com".*"p_group_ids":\[8\],"p_appointed_by":"<id of moderator@example\.com>"/,
  );
  assert.match(
    provisions[3],
    /"p_full_name":"Pop, Ana".*"p_appointed_by":"<id of presedinte@example\.com>"/,
  );
  // Positions come after every Member exists, then the Task history.
  const firstRole = plan.findIndex((line) => line.includes('set_group_role'));
  const lastProvision = plan.findLastIndex((line) => line.includes('provision_profile'));
  const firstRequest = plan.findIndex((line) => line.includes('create_completed_work_request'));
  assert.ok(lastProvision < firstRole && firstRole < firstRequest);
  assert.ok(
    plan.some((line) =>
      /set_group_role .*"p_group_role":"responsible","p_position_title":"Coordonator IT"/.test(
        line,
      ),
    ),
  );
  // The Moderator's own history is approved by the first BC, never by the Moderator.
  const moderatorTask = plan.findIndex((line) => line.includes('Migrarea site-ului OSUBB'));
  assert.match(
    plan[moderatorTask],
    /^\[\d+\/\d+\] as moderator@example\.com: rpc create_completed_work_request/,
  );
  assert.match(
    plan[moderatorTask + 1],
    /as presedinte@example\.com: rpc approve_completed_work_request .*"p_difficulty":5,"p_rating":3.*→ 5 Task Points/,
  );
  assert.ok(
    lines.some((line) =>
      line.includes('Summary: would create 5 Member(s) (1 Moderator), would import 4 Task(s).'),
    ),
  );
});

test('a dry run against a project with profiles warns and still prints the plan', async () => {
  const project = fakeProject({ profiles: [{ id: 'x', email: 'demo@demo.osubb' }] });
  const { code, output } = await run([...BOTH, '--dry-run'], project);
  assert.equal(code, 0);
  assert.match(
    output,
    /warning: the real run would stop here — PT409 bootstrap_refused: 1 profile\(s\) already exist/,
  );
  assert.match(output, /create user moderator@example\.com/);
  assert.deepEqual(project.writes(), []);
});

// ----------------------------------------------------------------- refusals

test('the real run is refused, before any write, once any profile exists', async () => {
  const project = fakeProject({ profiles: [{ id: 'x', email: 'someone@example.com' }] });
  const { code, output } = await run([...BOTH, '--execute'], project);
  assert.equal(code, 1);
  assert.match(output, /PT409 bootstrap_refused: 1 profile\(s\) already exist/);
  assert.deepEqual(project.writes(), []);
});

test('the real run is refused when Auth already holds an address from the file', async () => {
  const project = fakeProject({ authEmails: ['bce.edu@example.com'] });
  const { code, output } = await run([...BOTH, '--execute'], project);
  assert.equal(code, 1);
  assert.match(output, /PT409 bootstrap_refused: Auth already has bce\.edu@example\.com/);
  assert.deepEqual(project.writes(), []);
});

// ------------------------------------------------------------ the real run

test('the real run creates the Moderator first and appoints everyone else by name', async () => {
  const project = fakeProject();
  const { code, output } = await run([...BOTH, '--execute'], project);
  assert.equal(code, 0, output);
  const writes = project.writes();

  assert.equal(writes[0].path, '/auth/v1/admin/users');
  assert.deepEqual(writes[0].body, { email: 'moderator@example.com', email_confirm: true });
  const provisions = writes.filter((call) => call.path === '/rest/v1/rpc/provision_profile');
  assert.equal(provisions[0].body.p_role, 'moderator');
  assert.equal(provisions[0].body.p_appointed_by, null);
  for (const call of provisions.slice(1)) {
    assert.equal(call.body.p_group_ids.length, 1, 'one initial Group Appointment each');
    assert.equal(bearer(call), 'Bearer sb_secret_test', 'provisioning runs as the service key');
  }
  assert.equal(provisions[1].body.p_appointed_by, 'uid:moderator@example.com');
  assert.equal(provisions[3].body.p_appointed_by, 'uid:presedinte@example.com');

  // The Task commands run as Members, with their own sessions.
  const requests = writes.filter((call) => call.path.endsWith('/create_completed_work_request'));
  const approvals = writes.filter((call) => call.path.endsWith('/approve_completed_work_request'));
  assert.equal(requests.length, 4);
  assert.equal(approvals.length, 4);
  assert.equal(bearer(requests[0]), 'Bearer jwt:bce.edu@example.com');
  assert.equal(bearer(approvals[0]), 'Bearer jwt:moderator@example.com');
  assert.equal(approvals[0].body.p_request_id, 101);
  assert.match(
    approvals[0].body.p_note,
    /^Import istoric BC\/BCE \(#112\)\. Termen inițial: 2026-03-15\. Evaluat inițial: 2026-03-20\.$/,
  );
  assert.equal(bearer(requests[2]), 'Bearer jwt:moderator@example.com');
  assert.equal(bearer(approvals[2]), 'Bearer jwt:presedinte@example.com');
  assert.ok(
    !writes.some((call) => call.path.includes('points_ledger')),
    'never a direct ledger write',
  );

  // Every session the run opened is closed again.
  const signOuts = writes.filter((call) => call.path === '/auth/v1/logout');
  assert.equal(signOuts.length, writes.filter((call) => call.path === '/auth/v1/verify').length);
  assert.match(output, /Bootstrap complete\./);
});

test('a failure while creating Members deletes every Auth user the run created', async () => {
  const project = fakeProject({
    fail: (call) =>
      call.path.endsWith('/provision_profile') && call.body.p_email === 'bce.tineret@example.com',
  });
  const { code, output } = await run([...BOTH, '--execute'], project);
  assert.equal(code, 1);
  const deletes = project
    .writes()
    .filter((call) => call.method === 'DELETE')
    .map((call) => call.path);
  assert.deepEqual(deletes, [
    '/auth/v1/admin/users/uid:bce.tineret@example.com',
    '/auth/v1/admin/users/uid:bce.edu@example.com',
    '/auth/v1/admin/users/uid:presedinte@example.com',
    '/auth/v1/admin/users/uid:moderator@example.com',
  ]);
  assert.ok(!project.writes().some((call) => call.path.includes('completed_work_request')));
  assert.match(output, /Rolled back: the project has no profile from this run/);
});

test('a failure in the Task import keeps what exists and prints the resume command', async () => {
  const project = fakeProject({
    fail: (call) =>
      call.path.endsWith('/approve_completed_work_request') && call.body.p_request_id === 102,
  });
  const { code, output } = await run([...BOTH, '--execute'], project);
  assert.equal(code, 1);
  assert.ok(
    !project.writes().some((call) => call.method === 'DELETE'),
    'history is never rolled back',
  );
  assert.match(output, /Tasks rows imported: 2\./);
  assert.match(output, /tasks row 3 left Request 102 pending/);
  assert.match(output, /--execute --resume-tasks-from 4$/m);
});

test('--resume-tasks-from imports only the remaining rows, for Members that already exist', async () => {
  const emails = readContractCsv(readFileSync(MEMBERS_FILE, 'utf8'), MEMBER_COLUMNS, 'm').map(
    (row) => row.email,
  );
  const project = fakeProject({
    profiles: emails.map((email) => ({ id: `uid:${email}`, email, role: 'bce' })),
  });
  const { code, output } = await run([...BOTH, '--execute', '--resume-tasks-from', '4'], project);
  assert.equal(code, 0, output);
  const writes = project.writes();
  assert.ok(
    !writes.some(
      (call) => call.path === '/auth/v1/admin/users' || call.path.endsWith('/provision_profile'),
    ),
  );
  const requests = writes.filter((call) => call.path.endsWith('/create_completed_work_request'));
  assert.deepEqual(
    requests.map((call) => call.body.p_description),
    ['Migrarea site-ului OSUBB', 'Raportul anual'],
  );
});

// ------------------------------------------------------------- validation

function validate(memberCsv, taskCsv = TASK_COLUMNS.join(',')) {
  return validateInput({
    memberRows: readContractCsv(memberCsv, MEMBER_COLUMNS, 'members'),
    taskRows: readContractCsv(taskCsv, TASK_COLUMNS, 'tasks'),
    groups: GROUPS,
    today: '2026-10-02',
  });
}
const HEADER = MEMBER_COLUMNS.join(',');
const MODERATOR = 'mod@example.com,Mod Erator,,moderator,Diverse / Echipa IT,,,,';

test('phones follow rule R8, the same normalisation as the app and the database', () => {
  const { members, errors } = validate(
    [
      HEADER,
      MODERATOR,
      'a@example.com,A B,+40 0730-655-145,bce,EDU,,,,',
      'b@example.com,B C,0730 65,bce,EDU,,,,',
    ].join('\n'),
  );
  assert.equal(members[1].phone, '+40730655145');
  assert.deepEqual(
    errors.map((e) => [e.row, e.column]),
    [[4, 'phone']],
  );
});

test('the Moderator must come first, and only once', () => {
  const { errors } = validate(
    [HEADER, 'a@example.com,A B,,bce,EDU,,,,', 'm@example.com,M,,moderator,EDU,,,,'].join('\n'),
  );
  assert.deepEqual(
    errors.map((e) => `${e.row}:${e.column}`),
    ['2:role', '3:role'],
  );
});

test('a BC row may be appointed by an earlier BC row (ruling R31, #917), never by a BCE', () => {
  const { errors } = validate(
    [
      HEADER,
      MODERATOR,
      'b1@example.com,B One,,bc,EDU,,,,',
      'b2@example.com,B Two,,bc,EDU,,,,b1@example.com',
      'e@example.com,E,,bce,EDU,,,,b1@example.com',
      'b3@example.com,B Three,,bc,EDU,,,,e@example.com',
    ].join('\n'),
  );
  assert.deepEqual(
    errors.map((e) => `${e.row}:${e.column}`),
    ['6:appointed_by_email'],
    'provision_profile accepts a live BC as appointer; a BCE is not leadership',
  );
  assert.match(errors[0].message, /is not BC or the Moderator/);
});

test('every input rule is reported at once, with its row and column', () => {
  const { errors } = validate(
    [
      HEADER,
      MODERATOR,
      'not-an-email,,,bce,EDU,,,,',
      'x@example.com,X,,bce,Nowhere,,,,',
      'y@example.com,Y,,bce,Echipa IT,,,,',
      'z@example.com,Z,,bce,Adunarea Generala,,,,',
      'w@example.com,W,,bce,,,,,',
      'v@example.com,V,,bce,EDU,responsible,,,',
      'u@example.com,U,,bce,EDU,,,2030-01-01,x@example.com',
      'X@example.com,X again,,bce,EDU,,,,',
    ].join('\n'),
  );
  assert.deepEqual(
    errors.map((e) => `${e.row}:${e.column}`),
    [
      '3:email',
      '3:full_name',
      '4:group_path',
      '5:group_path',
      '6:group_path',
      '7:group_path',
      '8:position_title',
      '9:joined_at',
      '9:appointed_by_email',
      '10:email',
    ],
  );
  assert.match(errors[3].message, /names 2 Groups/, 'an ambiguous name is reported, never guessed');
  assert.match(errors[4].message, /Automatic Membership/);
});

test('a historical Task must fit its Executor, its Group and the Evaluation scale', () => {
  const members = [
    HEADER,
    MODERATOR,
    'a@example.com,A,,bce,EDU,member,,,',
    'm@example.com,M,,bce,Diverse,manager,,,',
  ].join('\n');
  const tasks = [
    TASK_COLUMNS.join(','),
    'a@example.com,Ok task,EDU,2026-01-10,3,4,2026-01-12,',
    'a@example.com,Wrong group,Tineret,,3,4,,',
    'm@example.com,Below a managed Group,Diverse / Echipa IT,,2,5,,',
    'nobody@example.com,Who,EDU,,3,4,,',
    'a@example.com,No,EDU,,6,0,,',
    'a@example.com,Bad date,EDU,2026-02-30,3,4,,',
    'mod@example.com,The Moderator,Diverse / Echipa IT,,3,4,,',
  ].join('\n');
  const { tasks: parsed, errors } = validate(members, tasks);
  assert.deepEqual(
    errors.map((e) => `${e.row}:${e.column}`),
    [
      '3:group_path',
      '5:executor_email',
      '6:title',
      '6:difficulty',
      '6:rating',
      '7:deadline',
      '8:executor_email',
    ],
  );
  assert.equal(parsed[0].points, 6);
  assert.equal(parsed[2].points, 6, 'a manager files work in a Group below their own');
});

test('the Group matching copy is the csv-import rule', () => {
  for (const value of [
    'Educaţional',
    'EDUCAȚIONAL',
    '  Resurse   Umane ',
    'Imagine & PR',
    'Tineret',
  ]) {
    assert.equal(normalizeGroupKey(value), denoNormalizeGroupKey(value));
  }
});

test('CSV parsing follows RFC 4180 and keeps spreadsheet row numbers', () => {
  const records = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n"multi\nline",z\n');
  assert.deepEqual(records, [
    { row: 1, cells: ['a', 'b'] },
    { row: 2, cells: ['x, y', 'say "hi"'] },
    { row: 4, cells: ['multi\nline', 'z'] },
  ]);
  assert.throws(
    () => readContractCsv('email,name\n', MEMBER_COLUMNS, 'members.csv'),
    /header must be exactly/,
  );
});

test('a Task call that gets no answer is reported as unknown, never as nothing written', async () => {
  const project = fakeProject({
    drop: (call) =>
      call.path.endsWith('/create_completed_work_request') &&
      call.body.p_description === 'Campania de recrutare Tineret',
  });
  const { code, output } = await run([...BOTH, '--execute'], project);
  assert.equal(code, 1);
  assert.doesNotMatch(output, /wrote nothing/);
  assert.match(
    output,
    /tasks row 3: the server gave no answer \(fetch failed\), so the outcome is unknown/,
  );
  assert.match(output, /If it is not there, resume with: .*--resume-tasks-from 3$/m);
  assert.match(output, /If it is there: .*--resume-tasks-from 4$/m);
});

test('an approval that gets no answer names its Request and never offers the same row again', async () => {
  const project = fakeProject({
    drop: (call) =>
      call.path.endsWith('/approve_completed_work_request') && call.body.p_request_id === 102,
  });
  const { code, output } = await run([...BOTH, '--execute'], project);
  assert.equal(code, 1);
  assert.match(output, /tasks row 3: Request 102 was filed, but its approval got no answer/);
  assert.match(output, /Never resume from row 3\./);
  assert.doesNotMatch(output, /--resume-tasks-from 3$/m);
  assert.match(output, /Then resume with: .*--resume-tasks-from 4$/m);
});

test('the secret key is sent over https, or over http to a local stack only', async () => {
  for (const [url, expected] of [
    ['http://example-ref.supabase.co', 2],
    ['not a url', 2],
    ['http://127.0.0.1:54321', 0],
    ['https://example-ref.supabase.co', 0],
  ]) {
    const project = fakeProject();
    const code = await main([...BOTH, '--dry-run'], {
      env: { ...ENV, SUPABASE_URL: url },
      fetchImpl: project.fetchImpl,
      log: () => {},
      readFile: (path) => readFileSync(path, 'utf8'),
      now: new Date('2026-10-02T06:00:00Z'),
    });
    assert.equal(code, expected, url);
    if (expected === 2) assert.deepEqual(project.calls, [], `no request to ${url}`);
  }
});

test('usage mistakes stop before any request', async () => {
  const project = fakeProject();
  assert.equal((await run(['--members', MEMBERS_FILE], project)).code, 2);
  assert.equal((await run([...BOTH, '--dry-run', '--execute'], project)).code, 2);
  const legacy = await main([...BOTH, '--execute'], {
    env: { ...ENV, SUPABASE_SECRET_KEY: 'legacy-service-role-jwt' },
    fetchImpl: project.fetchImpl,
    log: () => {},
    readFile: (path) => readFileSync(path, 'utf8'),
  });
  assert.equal(legacy, 2, 'the legacy service_role key is refused (ruling L8)');
  assert.deepEqual(project.calls, []);
});
