-- tracker_grants.test.sql — #295: grants and default privileges across the
-- Task surface. Pure ACL assertions (has_table_privilege /
-- has_sequence_privilege / has_function_privilege): no session, no JWT, no
-- fixture rows needed -- these checks are role-level, not row-level, so they
-- hold with an empty database.
--
-- How a *new* object is caught:
--   - Tables/sequences/views: `pg_temp.task_surface_objects()` is a fixed
--     array. It intentionally does NOT self-discover new Task tables --
--     that is #295's own object list from the issue, and a new Task table
--     needs its own audited entry in `expected_table_privs` /
--     `expected_sequence_privs` before it ships (silence here is not
--     coverage). What this suite *does* self-discover is drift on the
--     objects already listed.
--   - `private` functions: `pinned_private_functions` is a closed roster
--     (one row per current `pg_proc` row in `private` -- no fixed count is
--     quoted here, because every later branch that adds a function adds a
--     row and bumps the count assertion below). Two assertions
--     below diff the roster against live `pg_proc` in both directions, so
--     adding, renaming, or dropping any function in `private` fails the
--     suite until the roster is updated -- there is no naming-pattern
--     escape hatch a new function could slip through unnoticed. A third
--     assertion then checks every *pinned* function's actual grant against
--     its recorded category (impl/predicate/authenticated_only all reduce
--     to "authenticated only"; require/trigger/none all reduce to "nobody,
--     not even service_role" -- kept as separate labels because the reason
--     differs even though the grant outcome doesn't: a `require_*` helper
--     raises or returns the actor for a command that calls it as owner, a
--     trigger function never wants a direct caller, and `notify`/
--     `task_managers` simply have no caller yet ahead of #330-#345).
--
-- Known follow-up (E2, #295 review): the closed roster is a dated break
-- someone must own, not a one-time count to get right and forget. It goes
-- red the instant `private` gains a function this file doesn't know about --
-- dobrerares' #368 (`private.set_updated_at()`) did exactly that when it
-- merged to main -- it is pinned in the roster below now. Any later addition
-- to `private` does the same. The remedy is
-- always the one line the assertions already point at: add the new
-- function's `(proname, args, category)` row to `pinned_private_functions`
-- above (and adjust the plan(N)/count(*) pins next to it) -- there is no
-- broader redesign needed, just upkeep every time `private` grows.

begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(16);

-- ==================== Fixed object list (#295's own surface) ====================

create function pg_temp.task_surface_objects() returns text[]
language sql as $$
  -- #345 dropped task_assignees and task_requests; both are gone from this
  -- roster with their tables, and rls_deny_by_default.test.sql asserts they
  -- no longer exist at all.
  select array[
    'tasks', 'task_assignments', 'task_candidates',
    'task_activity', 'task_evaluations', 'campaigns',
    'completed_work_requests', 'points_ledger',
    'tasks_with_overdue', 'task_queue_summary'
  ]
$$;

create function pg_temp.task_surface_sequences() returns text[]
language sql as $$
  -- #345: task_requests_id_seq went with its table.
  select array[
    'tasks_id_seq', 'task_assignments_id_seq', 'task_candidates_id_seq',
    'task_activity_id_seq', 'task_evaluations_id_seq', 'campaigns_id_seq',
    'completed_work_requests_id_seq',
    'points_ledger_id_seq'
  ]
$$;

-- ==================== 1. anon: zero privileges anywhere ====================

create function pg_temp.anon_grants_on_task_surface() returns text[]
language sql as $$
  select coalesce(array_agg(distinct table_name order by table_name), '{}')
    from information_schema.role_table_grants
   where grantee = 'anon'
     and table_schema = 'public'
     and table_name = any (pg_temp.task_surface_objects())
$$;

select is(pg_temp.anon_grants_on_task_surface(), '{}'::text[],
  'anon holds zero privileges on every Task table/view (AC: anon has no Task data privileges)');

create function pg_temp.anon_sequence_grants_on_task_surface() returns text[]
language sql as $$
  select coalesce(array_agg(distinct seq order by seq), '{}')
    from unnest(pg_temp.task_surface_sequences()) as seq
   where has_sequence_privilege('anon', 'public.' || seq, 'usage')
      or has_sequence_privilege('anon', 'public.' || seq, 'select')
      or has_sequence_privilege('anon', 'public.' || seq, 'update')
$$;

select is(pg_temp.anon_sequence_grants_on_task_surface(), '{}'::text[],
  'anon holds zero privileges on every Task sequence');

-- ==================== 2. TRUNCATE / REFERENCES / TRIGGER: nobody ====================

create function pg_temp.ddl_adjacent_grants(p_role text) returns text[]
language sql as $$
  select coalesce(array_agg(distinct table_name order by table_name), '{}')
    from information_schema.role_table_grants
   where grantee = p_role
     and table_schema = 'public'
     and table_name = any (pg_temp.task_surface_objects())
     and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')
$$;

select is(pg_temp.ddl_adjacent_grants('authenticated'), '{}'::text[],
  'authenticated cannot truncate, reference, or trigger any Task table/view');

select is(pg_temp.ddl_adjacent_grants('service_role'), '{}'::text[],
  'service_role cannot truncate, reference, or trigger any Task table/view either');

-- ==================== 3. DML matrix (authenticated / service_role) ====================
-- Every command-owned table (tasks, campaigns, task_assignments,
-- task_candidates, task_activity, task_evaluations, completed_work_requests)
-- is select-only for authenticated, since #327-#345's commands own their
-- writes -- #345 closed the last of them, `tasks`, along with the two legacy
-- tables that used to appear here with full DML.
-- points_ledger keeps INSERT for authenticated: the sanction path
-- (points_ledger_create_sanction) is still a direct, policy-gated write, not a command.
-- service_role is untouched by #345 -- narrowing it further is #295's audit.

create temporary table expected_table_privs (
  object_name text not null,
  role_name   text not null,
  expected    text not null,
  primary key (object_name, role_name)
) on commit drop;

insert into expected_table_privs (object_name, role_name, expected) values
  ('tasks',                    'authenticated', 'SELECT'),
  ('tasks',                    'service_role',  'DELETE,INSERT,SELECT,UPDATE'),
  ('points_ledger',            'authenticated', 'INSERT,SELECT'),
  ('points_ledger',            'service_role',  'SELECT'),
  ('task_activity',            'authenticated', 'SELECT'),
  ('task_activity',            'service_role',  'INSERT,SELECT'),
  ('task_assignments',         'authenticated', 'SELECT'),
  ('task_assignments',         'service_role',  'SELECT'),
  ('task_candidates',          'authenticated', 'SELECT'),
  ('task_candidates',          'service_role',  'SELECT'),
  ('task_evaluations',         'authenticated', 'SELECT'),
  ('task_evaluations',         'service_role',  'SELECT'),
  ('campaigns',                'authenticated', 'SELECT'),
  ('campaigns',                'service_role',  'SELECT'),
  ('completed_work_requests',  'authenticated', 'SELECT'),
  ('completed_work_requests',  'service_role',  'SELECT'),
  ('tasks_with_overdue',       'authenticated', 'SELECT'),
  ('tasks_with_overdue',       'service_role',  'SELECT'),
  ('task_queue_summary',       'authenticated', 'SELECT'),
  ('task_queue_summary',       'service_role',  'SELECT');

create function pg_temp.dml_mismatches(p_role text) returns text[]
language sql as $$
  select coalesce(array_agg(e.object_name order by e.object_name), '{}')
    from expected_table_privs e
   where e.role_name = p_role
     and e.expected <> coalesce((
       select string_agg(g.privilege_type, ',' order by g.privilege_type)
         from information_schema.role_table_grants g
        where g.grantee = p_role
          and g.table_schema = 'public'
          and g.table_name = e.object_name
          and g.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
     ), '')
$$;

select is(pg_temp.dml_mismatches('authenticated'), '{}'::text[],
  'authenticated''s DML on every Task table/view matches the audited posture exactly (select-only where a command owns writes, unchanged legacy write paths otherwise)');

select is(pg_temp.dml_mismatches('service_role'), '{}'::text[],
  'service_role''s DML on every Task table/view is narrowed to what it actually needs (select, or select+insert for task_activity) -- #295 closes the campaigns/task_assignments/points_ledger over-grants');

-- ==================== 4. Sequence USAGE/SELECT/UPDATE matrix ====================
-- UPDATE (setval) is never granted to any role on any Task sequence: no
-- insert path needs it, and it isn't governed by RLS.

create temporary table expected_sequence_privs (
  object_name text not null,
  role_name   text not null,
  expected    text not null,
  primary key (object_name, role_name)
) on commit drop;

insert into expected_sequence_privs (object_name, role_name, expected) values
  ('tasks_id_seq',                    'authenticated', 'SELECT,USAGE'),
  ('tasks_id_seq',                    'service_role',  'SELECT,USAGE'),
  ('points_ledger_id_seq',            'authenticated', 'SELECT,USAGE'),
  ('points_ledger_id_seq',            'service_role',  ''),
  ('task_activity_id_seq',            'authenticated', ''),
  ('task_activity_id_seq',            'service_role',  'SELECT,USAGE'),
  ('task_assignments_id_seq',         'authenticated', ''),
  ('task_assignments_id_seq',         'service_role',  ''),
  ('task_candidates_id_seq',          'authenticated', ''),
  ('task_candidates_id_seq',          'service_role',  ''),
  ('task_evaluations_id_seq',         'authenticated', ''),
  ('task_evaluations_id_seq',         'service_role',  ''),
  ('campaigns_id_seq',                'authenticated', ''),
  ('campaigns_id_seq',                'service_role',  ''),
  ('completed_work_requests_id_seq',  'authenticated', ''),
  ('completed_work_requests_id_seq',  'service_role',  '');

create function pg_temp.seq_privs(p_role text, p_seq text) returns text
language sql as $$
  select coalesce(string_agg(p, ',' order by p), '')
    from (
      select 'SELECT' as p where has_sequence_privilege(p_role, 'public.' || p_seq, 'select')
      union all
      select 'UPDATE' where has_sequence_privilege(p_role, 'public.' || p_seq, 'update')
      union all
      select 'USAGE' where has_sequence_privilege(p_role, 'public.' || p_seq, 'usage')
    ) x
$$;

create function pg_temp.sequence_mismatches() returns text[]
language sql as $$
  select coalesce(array_agg(e.object_name || ':' || e.role_name order by 1), '{}')
    from expected_sequence_privs e
   where e.expected <> pg_temp.seq_privs(e.role_name, e.object_name)
$$;

select is(pg_temp.sequence_mismatches(), '{}'::text[],
  'every Task sequence''s usage/select/update for authenticated and service_role matches the audited posture -- no role can rewrite an id counter via setval, and every over-broad grant #295 found is gone');

-- ==================== 5. Views stay security_invoker ====================

create function pg_temp.non_invoker_task_views() returns text[]
language sql as $$
  select coalesce(array_agg(c.relname order by c.relname), '{}')
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
   where c.relname in ('tasks_with_overdue', 'task_queue_summary')
     and coalesce(c.reloptions::text, '') not like '%security_invoker=on%'
$$;

select is(pg_temp.non_invoker_task_views(), '{}'::text[],
  'both Task views stay security_invoker=on -- never run as the view owner, bypassing RLS');

-- ==================== 6. Public Task-related functions ====================

create temporary table expected_function_privs (
  proname text not null,
  args    text not null,
  anon    boolean not null,
  auth_ex boolean not null,
  svc     boolean not null,
  pub     boolean not null,
  primary key (proname, args)
) on commit drop;

insert into expected_function_privs (proname, args, anon, auth_ex, svc, pub) values
  ('update_event', 'p_event_id bigint, p_title text, p_type text, p_group_id bigint, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_location text, p_capacity integer, p_description text, p_min_level integer', false, true, false, false),
  ('cancel_event', 'p_event_id bigint, p_reason text', false, true, false, false),
  -- #345 dropped public.claim_open_task; its row went with it.
  ('create_event', 'p_title text, p_type text, p_group_id bigint, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_location text, p_capacity integer, p_description text, p_min_level integer', false, true, false, false),
  ('rating_mult',        'r integer',                                false, true,  true,  false),
  ('auth_level',         '',                                         false, true,  true,  false),
  ('auth_role',          '',                                         false, true,  true,  false),
  ('auth_in_dept',       'd text',                                   false, true,  true,  false),
  ('auth_in_team',       't text',                                   false, true,  true,  false),
  ('auth_is_member',     '',                                         false, true,  true,  false),
  -- #510: the Group Wave 1 JWT helper, same grant shape as auth_in_team.
  ('auth_in_group',      'g bigint',                                 false, true,  true,  false),
  ('create_campaign',    'p_group_id bigint, p_name text', false, true, false, false),
  ('create_campaign',    'p_department_id text, p_name text',        false, true,  false, false),
  ('update_campaign',    'p_campaign_id bigint, p_name text',        false, true,  false, false),
  ('set_campaign_active','p_campaign_id bigint, p_active boolean',   false, true,  false, false),
  -- #580: the two Member command wrappers. Same grant shape as every other
  -- wrapper -- authenticated only, never anon, service_role or PUBLIC -- even
  -- though only BC and the Moderator can get past their gate.
  ('set_member_role',    'p_member_id uuid, p_role member_role',     false, true,  false, false),
  ('set_member_status',  'p_member_id uuid, p_status member_status', false, true,  false, false),
  -- #327: the first Task command wrapper. Every later wrapper (#328-#345)
  -- adds its own row here the same way.
  ('create_task',        'p_title text, p_description text, p_deadline timestamp with time zone, p_dept_id text, p_team_id text, p_project_id bigint, p_audience text, p_assignment_mode text, p_executor_id uuid, p_campaign_id bigint, p_parent_task_id bigint, p_kind text, p_group_id bigint',
                                                                     false, true,  false, false),
  -- #328: the second Task command wrapper, added the same way #327's own
  -- comment above instructs every later wrapper (#329-#345) to.
  ('update_task_content','p_task_id bigint, p_title text, p_description text, p_deadline timestamp with time zone, p_campaign_id bigint',
                                                                     false, true,  false, false),
  -- #329: the third Task command wrapper, added the same way.
  ('convert_task_mode',  'p_task_id bigint, p_assignment_mode text, p_audience text',
                                                                     false, true,  false, false),
  -- #330: the Candidate Queue pair, added the same way.
  ('express_task_interest',  'p_task_id bigint',                     false, true,  false, false),
  ('withdraw_task_interest', 'p_task_id bigint',                     false, true,  false, false),
  -- #331: the fourth Task command wrapper, added the same way.
  ('set_task_queue',         'p_task_id bigint, p_open boolean',     false, true,  false, false),
  -- #342: the fifth Task command wrapper, added the same way.
  ('assign_task_executor',   'p_task_id bigint, p_member_id uuid',   false, true,  false, false),
  -- #332: the sixth Task command wrapper, added the same way.
  ('give_up_task',           'p_task_id bigint, p_reason text',      false, true,  false, false),
  -- #333: the seventh Task command wrapper, added the same way.
  ('select_task_candidate',  'p_task_id bigint, p_candidate_id bigint, p_close_remaining boolean',
                                                                     false, true,  false, false),
  -- #334: the eighth and ninth Task command wrappers, added the same way.
  ('start_task',              'p_task_id bigint',                    false, true,  false, false),
  ('submit_task_for_review',  'p_task_id bigint',                    false, true,  false, false),
  -- #335: the tenth Task command wrapper, added the same way.
  ('return_task_to_progress', 'p_task_id bigint, p_note text',       false, true,  false, false),
  -- #336: the eleventh Task command wrapper, added the same way.
  ('complete_task_review',   'p_task_id bigint, p_difficulty integer, p_rating integer, p_note text',
                                                                     false, true,  false, false),
  -- #337: the twelfth Task command wrapper, added the same way.
  ('mark_task_unfulfilled',  'p_task_id bigint, p_difficulty integer, p_rating integer, p_note text',
                                                                     false, true,  false, false),
  -- #338: the thirteenth Task command wrapper, added the same way.
  ('reopen_task',            'p_task_id bigint, p_reason text',      false, true,  false, false),
  -- #339: the fourteenth Task command wrapper, added the same way.
  ('cancel_task',            'p_task_id bigint, p_reason text',      false, true,  false, false),
  -- #340: the fifteenth Task command wrapper, added the same way.
  ('complete_umbrella_task', 'p_task_id bigint',                     false, true,  false, false),
  -- #341: the sixteenth Task command wrapper, added the same way.
  ('duplicate_task',         'p_task_id bigint, p_deadline timestamp with time zone', false, true, false, false),
  -- #344: the three Completed-work Request wrappers, added the same way.
  ('create_completed_work_request',  'p_description text, p_dept_id text, p_team_id text, p_project_id bigint, p_group_id bigint',
                                                                     false, true,  false, false),
  ('approve_completed_work_request', 'p_request_id bigint, p_difficulty integer, p_rating integer, p_note text',
                                                                     false, true,  false, false),
  ('reject_completed_work_request',  'p_request_id bigint, p_note text',
                                                                     false, true,  false, false),
  -- #259: the Campaign-filtered Department Cup read wrapper. Same grant shape
  -- as every command wrapper -- authenticated only -- even though it writes
  -- nothing: the BCE+ gate lives inside the function, not in the grant.
  ('department_cup',                 'p_campaign_id bigint',         false, true,  false, false),
  -- #260: the leadership drill-down over one Member's Assignment history.
  ('leadership_member_tasks',        'p_member_id uuid',             false, true,  false, false),
  -- #258: the Task-Points Leaderboard, filterable by Origin and Campaign.
  ('leadership_leaderboard',         'p_group_id bigint, p_campaign_id bigint',
                                                                     false, true,  false, false),
  -- #499: a deliberately narrow batch read for the current Executor of Tasks
  -- the caller may already read. Assignment history remains behind its RLS.
  ('visible_task_executors',          'p_task_ids bigint[]',          false, true,  false, false),
  -- #625: the Campaign reporting reads -- per-volunteer report and
  -- whole-Campaign totals. Same grant shape as every read wrapper --
  -- authenticated only, gated inside the function (private.can_manage_group_work).
  ('campaign_report',                'p_campaign_id bigint',         false, true,  false, false),
  ('campaign_totals',                'p_campaign_id bigint',         false, true,  false, false),
  -- #626: the full-state Task edit and its read-only consequence preview.
  ('update_task',            'p_task_id bigint, p_title text, p_description text, p_deadline timestamp with time zone, p_campaign_id bigint, p_assignment_mode text, p_audience text, p_accept_consequences boolean',
                                                                     false, true,  false, false),
  ('preview_task_update',    'p_task_id bigint, p_title text, p_description text, p_deadline timestamp with time zone, p_campaign_id bigint, p_assignment_mode text, p_audience text',
                                                                     false, true,  false, false),
  -- #576: the capability row and the caller's effective Groups. Read-only
  -- wrappers with the same grant shape as every other wrapper.
  ('my_capabilities',        '',                                     false, true,  false, false),
  ('my_groups',              '',                                     false, true,  false, false);

create function pg_temp.public_function_mismatches() returns text[]
language plpgsql as $$
declare
  f record; fn_oid oid; leaks text[] := '{}';
begin
  for f in select * from expected_function_privs loop
    select p.oid into fn_oid
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
     where p.proname = f.proname
       and pg_get_function_identity_arguments(p.oid) = f.args;

    if fn_oid is null then
      leaks := leaks || (f.proname || ': not found');
      continue;
    end if;

    if has_function_privilege('anon', fn_oid, 'execute') is distinct from f.anon
       or has_function_privilege('authenticated', fn_oid, 'execute') is distinct from f.auth_ex
       or has_function_privilege('service_role', fn_oid, 'execute') is distinct from f.svc
       or has_function_privilege('public', fn_oid, 'execute') is distinct from f.pub
    then
      leaks := leaks || f.proname;
    end if;
  end loop;
  return leaks;
end
$$;

select is(pg_temp.public_function_mismatches(), '{}'::text[],
  'every public Task-related command/helper (rating_mult, the auth_* JWT helpers incl. #510''s auth_in_group, the three Campaign wrappers, every #327-#344 Task command wrapper, the three leadership read wrappers, and #499''s narrow visible Executor read) has exactly its audited execute grants -- authenticated only, never anon, service_role or PUBLIC');

-- ==================== 7. private schema: pinned function roster ====================

create temporary table pinned_private_functions (
  proname  text not null,
  args     text not null,
  category text not null check (category in ('impl', 'predicate', 'authenticated_only', 'require', 'trigger', 'none')),
  primary key (proname, args)
) on commit drop;

insert into pinned_private_functions (proname, args, category) values
  ('add_department_team_member_impl',             'p_team_id text, p_member_id uuid',                                                                                   'impl'),
  ('add_independent_team_member_impl',            'p_team_id text, p_member_id uuid',                                                                                   'impl'),
  ('add_project_member_impl',                     'p_project_id bigint, p_member_id uuid',                                                                              'impl'),
  -- #344: approving a Completed-work Request mints the completed Task, its
  -- Evaluation and its ledger credit in one transaction.
  ('approve_completed_work_request_impl',         'p_request_id bigint, p_difficulty integer, p_rating integer, p_note text',                                           'impl'),
  ('archive_project_impl',                        'p_project_id bigint',                                                                                                'impl'),
  ('assign_task_executor_impl',                   'p_task_id bigint, p_member_id uuid',                                                                                 'impl'),
  ('actor_level',                                 'p_actor uuid',                                                                                                      'none'),
  -- #339: cancelling a Task with a recorded reason, plus its Umbrella cascade.
  ('cancel_task_impl',                            'p_task_id bigint, p_reason text',                                                                                    'impl'),
  -- #507: rewrites every descendant's ancestor prefix when a Group moves.
  ('cascade_group_path',                          '',                                                                                                                   'trigger'),
  ('caller_level',                                 '',                                                                                                                   'predicate'),
  -- #625: the Campaign reporting reads -- points earned and volunteers who
  -- worked on it. Same grant shape as every other read body ('impl'):
  -- authenticated only, gated inside the function itself
  -- (private.can_manage_group_work), never a silent empty result.
  ('campaign_report_impl',                        'p_campaign_id bigint',                                                                                               'impl'),
  ('campaign_totals_impl',                        'p_campaign_id bigint',                                                                                               'impl'),
  ('can_administer_team_structure',               'p_dept_id text',                                                                                                     'predicate'),
  -- #507: the Group roster predicate behind group_members_read. It walks
  -- groups.path, so a Group Manager or Responsible of an ancestor reads every
  -- Group below it.
  ('can_read_group_roster',                       'p_group_id bigint',                                                                                                  'predicate'),
  ('can_evaluate_task',                           'p_task_id bigint',                                                                                                   'predicate'),
  ('can_manage_department_memberships',           '',                                                                                                                   'predicate'),
  ('can_manage_origin',                           'p_dept_id text, p_team_id text, p_project_id bigint',                                                                'predicate'),
  ('can_manage_project_work',                     'p_project_id bigint',                                                                                                'predicate'),
  ('can_manage_task',                             'p_task_id bigint',                                                                                                   'predicate'),
  ('can_read_task',                               'p_task_id bigint',                                                                                                   'predicate'),
  ('can_read_team',                               'p_team_id text',                                                                                                     'predicate'),
  ('close_task_queue',                            'p_task_id bigint, p_decided_by uuid',                                                                                'none'),
  ('complete_task_review_impl',                   'p_task_id bigint, p_difficulty integer, p_rating integer, p_note text',                                             'impl'),
  -- #340: the Umbrella rollup -- completes it once every Subtask is terminal.
  ('complete_umbrella_task_impl',                 'p_task_id bigint',                                                                                                   'impl'),
  ('convert_task_mode_impl',                      'p_task_id bigint, p_assignment_mode text, p_audience text',                                                         'impl'),
  ('create_campaign_impl',                        'p_group_id bigint, p_name text',                                                                                  'impl'),
  -- #344: filing a Completed-work Request -- membership, not management.
  ('create_completed_work_request_impl',          'p_description text, p_dept_id text, p_team_id text, p_project_id bigint, p_group_id bigint',                                            'impl'),
  ('create_project_impl',                         'p_name text, p_leader_id uuid',                                                                                      'impl'),
  ('create_task_impl',                            'p_title text, p_description text, p_deadline timestamp with time zone, p_dept_id text, p_team_id text, p_project_id bigint, p_audience text, p_assignment_mode text, p_executor_id uuid, p_campaign_id bigint, p_parent_task_id bigint, p_kind text, p_group_id bigint', 'impl'),
  -- #259: the Department Cup body behind both the legacy `dept_cup` view and
  -- the filtered `public.department_cup(p_campaign_id)` wrapper.
  ('department_cup_rows',                         'p_campaign_id bigint',                                                                                               'authenticated_only'),
  -- #341: clone a Task into a brand-new todo Task with a fresh deadline.
  ('duplicate_task_impl',                         'p_task_id bigint, p_deadline timestamp with time zone',                                                             'impl'),
  ('end_task_assignment',                         'p_assignment_id bigint, p_reason text, p_note text',                                                                 'none'),
  -- #336: the shared Evaluation core -- the one place points are computed
  -- and written. `none`: it trusts its caller to hold the tasks row lock and
  -- to have authorized, so no role may ever reach it directly.
  ('evaluate_task',                               'p_task_id bigint, p_outcome text, p_difficulty integer, p_rating integer, p_note text, p_actor uuid',               'none'),
  ('express_task_interest_impl',                  'p_task_id bigint',                                                                                                   'impl'),
  ('give_up_task_impl',                           'p_task_id bigint, p_reason text',                                                                                    'impl'),
  ('grant_project_responsible_impl',              'p_project_id bigint, p_member_id uuid',                                                                              'impl'),
  -- #519: the resolver behind the four group_id/legacy-Origin sync triggers below --
  -- the Group that masters a legacy Origin (project, else team, else department).
  -- `none`: called only by those four triggers and by the migration's own backfill.
  ('group_id_for_legacy_origin',                  'p_dept_id text, p_team_id text, p_project_id bigint',                                                                'none'),
  ('guard_task_evaluation_change',                '',                                                                                                                   'trigger'),
  ('guard_task_duplicate_provenance',             '',                                                                                                                   'trigger'),
  ('is_active_project_member',                    'p_project_id bigint',                                                                                                'predicate'),
  ('is_global_task_reader',                       '',                                                                                                                   'predicate'),
  ('is_own_assignment',                           'p_assignment_id bigint',                                                                                             'predicate'),
  ('is_project_lead',                             'p_project_id bigint',                                                                                                'predicate'),
  ('is_project_responsible',                      'p_project_id bigint',                                                                                                'predicate'),
  ('is_task_candidate',                           'p_task_id bigint',                                                                                                   'predicate'),
  ('is_task_executor',                            'p_task_id bigint',                                                                                                   'predicate'),
  ('is_task_team_member',                         'p_task_id bigint',                                                                                                   'predicate'),
  -- #258: the Task-Points Leaderboard body behind
  -- `public.leadership_leaderboard(group, campaign)`.
  ('leadership_leaderboard_impl',                 'p_group_id bigint, p_campaign_id bigint',                                   'authenticated_only'),
  ('leadership_member_tasks_impl',                'p_member_id uuid',                                                                                                  'impl'),
  ('log_task_activity',                           'p_task_id bigint, p_kind text, p_actor uuid, p_assignment_id bigint, p_from task_status, p_to task_status, p_note text, p_details jsonb', 'none'),
  -- #337: the second command over the shared evaluate_task core (#336) --
  -- the `unfulfilled` outcome for overdue, undelivered work.
  ('mark_task_unfulfilled_impl',                  'p_task_id bigint, p_difficulty integer, p_rating integer, p_note text',                                             'impl'),
  -- #509: the seven mirror trigger functions (ADR-0009 Wave 1). Category
  -- `trigger`: nothing may call one directly. They are `security definer`
  -- because the legacy writes they observe arrive from `authenticated`
  -- sessions (member_departments_manage, teams_create, profiles_update_self)
  -- that hold no write grant on `groups`/`group_members` at all.
  ('mirror_department_group',                     '',                                                                                                                   'trigger'),
  ('mirror_department_membership',                '',                                                                                                                   'trigger'),
  ('mirror_project_group',                        '',                                                                                                                   'trigger'),
  ('mirror_project_membership',                   '',                                                                                                                   'trigger'),
  ('mirror_team_group',                           '',                                                                                                                   'trigger'),
  ('mirror_team_membership',                      '',                                                                                                                   'trigger'),
  -- #50: internal trigger function; no client execution.
  ('guard_role_history', '', 'trigger'),
  -- #69: scheduler-only job.
  ('remind_deadlines', '', 'none'),
  ('notify',                                      'p_recipients uuid[], p_kind noti_kind, p_title text, p_body text, p_task_id bigint, p_dedupe_key text, p_actor uuid, p_link text', 'none'),
  ('open_task_assignment',                        'p_task_id bigint, p_member_id uuid, p_actor uuid, p_via text',                                                       'none'),
  ('pending_candidate_count',                     'p_task_id bigint',                                                                                                   'authenticated_only'),
  ('protect_active_project_manager_deactivation', '',                                                                                                                   'trigger'),
  ('protect_project_leader_membership',           '',                                                                                                                   'trigger'),
  ('queue_position',                              'p_task_id bigint, p_member_id uuid',                                                                                 'authenticated_only'),
  -- #509: rank BCE *is* a Department Group's Group Manager, so a promotion or
  -- demotion re-derives that Group Role. Same `trigger` category and the same
  -- definer reasoning as the six mirrors above.
  ('rederive_department_group_roles',             '',                                                                                                                   'trigger'),
  -- #344: rejecting a Completed-work Request -- a reason, and no Task.
  ('reject_completed_work_request_impl',          'p_request_id bigint, p_note text',                                                                                   'impl'),
  ('reject_legacy_evaluation_source',             '',                                                                                                                   'trigger'),
  ('reject_task_activity_change',                 '',                                                                                                                   'trigger'),
  ('remove_department_team_member_impl',          'p_team_id text, p_member_id uuid',                                                                                   'impl'),
  ('remove_independent_team_member_impl',         'p_team_id text, p_member_id uuid',                                                                                   'impl'),
  ('remove_project_member_impl',                  'p_project_id bigint, p_member_id uuid',                                                                              'impl'),
  -- #338: the undo of an Evaluation -- the one command that reverses points.
  ('reopen_task_impl',                            'p_task_id bigint, p_reason text',                                                                                    'impl'),
  ('require_active_project_lead',                 'p_project_id bigint',                                                                                                'require'),
  ('require_active_member',                       '',                                                                                                                   'require'),
  ('request_deciders', 'p_request_id bigint', 'none'),
  ('can_decide_request', 'p_request_id bigint', 'predicate'),
  ('require_campaign_manager',                    'p_group_id bigint',                                                                                               'require'),
  -- #625 fix round 1: the shared preamble both Campaign reporting bodies
  -- call with `perform`, never an assignment (Sec4's unused-variable trap).
  ('require_campaign_report_access',              'p_campaign_id bigint',                                                                                               'require'),
  ('require_department_team_membership_manager',  'p_team_id text',                                                                                                     'require'),
  ('require_independent_team_membership_manager', 'p_team_id text',                                                                                                     'require'),
  ('require_origin_manager',                      'p_dept_id text, p_team_id text, p_project_id bigint',                                                                'require'),
  ('require_project_admin',                       '',                                                                                                                   'require'),
  -- #344: who may DECIDE a Completed-work Request -- narrower than
  -- private.can_manage_origin (no Project Responsible, no Independent-Team
  -- member) and, like every require_*, granted to nobody.
  ('require_request_decider',                     'p_request_id bigint',                                                                                                'require'),
  ('require_task_evaluator',                      'p_task_id bigint',                                                                                                   'require'),
  ('require_task_executor',                       'p_task_id bigint',                                                                                                   'require'),
  ('require_task_manager',                        'p_task_id bigint',                                                                                                   'require'),
  ('require_task_visible',                        'p_task_id bigint',                                                                                                   'require'),
  ('return_task_to_progress_impl',                'p_task_id bigint, p_note text',                                                                                      'impl'),
  -- #603: deletes a deactivated Member's GoTrue session rows. `none`, the
  -- strictest category: private.set_member_status_impl is its only caller and
  -- runs it as the function owner, and a client that could reach it directly
  -- would hold an unaudited sign-out for any Member in OSUBB.
  ('revoke_member_sessions',                      'p_member_id uuid',                                                                                                   'none'),
  ('revoke_project_responsible_impl',             'p_project_id bigint, p_member_id uuid',                                                                              'impl'),
  ('select_task_candidate_impl',                  'p_task_id bigint, p_candidate_id bigint, p_close_remaining boolean',                                                 'impl'),
  ('set_campaign_active_impl',                    'p_campaign_id bigint, p_active boolean',                                                                             'impl'),
  -- #580: the two audited Member commands. `impl` like every other command
  -- body -- the level-6 gate, the Moderator-only branch and the self-target
  -- refusal live inside the function, not in the grant.
  ('set_member_role_impl',                        'p_member_id uuid, p_role member_role',                                                                               'impl'),
  ('set_member_status_impl',                      'p_member_id uuid, p_status member_status',                                                                           'impl'),
  ('set_task_queue_impl',                         'p_task_id bigint, p_open boolean',                                                                                   'impl'),
  ('set_updated_at',                               '',                                                                                                                   'trigger'), -- #368, merged to main
  ('start_task_impl',                             'p_task_id bigint',                                                                                                   'impl'),
  ('submit_task_for_review_impl',                 'p_task_id bigint',                                                                                                   'impl'),
  ('sync_project_leader_membership',              '',                                                                                                                   'trigger'),
  -- #519: the four two-way group_id/legacy-Origin sync triggers (ADR-0009 Wave 2 bridge).
  -- A legacy write derives group_id; a Group write derives the legacy Origin; both sides
  -- set inconsistently is refused. `trigger`: nothing may call one directly.
  ('sync_campaign_group_origin',                  '',                                                                                                                   'trigger'),
  ('sync_event_group_origin',                     '',                                                                                                                   'trigger'),
  ('sync_request_group_origin',                   '',                                                                                                                   'trigger'),
  ('sync_task_group_origin',                      '',                                                                                                                   'trigger'),
  -- #508: the Group mirror family (ADR-0009 Wave 1). Category `none`: the
  -- backfill statement at the end of its own migration and #509's row triggers
  -- are the only callers, and both run as the table owner. Granting any of
  -- these back would hand a client a write path into `groups`/`group_members`,
  -- which #507 deliberately left read-only for every role.
  ('sync_department_groups',                      'p_dept_id text',                                                                                                     'none'),
  ('sync_team_groups',                            'p_team_id text',                                                                                                     'none'),
  ('sync_project_groups',                         'p_project_id bigint',                                                                                                'none'),
  ('sync_department_memberships',                 'p_member_id uuid, p_dept_id text',                                                                                   'none'),
  ('sync_team_memberships',                       'p_team_id text, p_member_id uuid',                                                                                   'none'),
  ('sync_project_memberships',                    'p_project_id bigint, p_member_id uuid',                                                                              'none'),
  ('sync_groups_from_legacy',                     '',                                                                                                                   'none'),
  -- #345 dropped private.task_is_unassigned with the legacy task table it
  -- queried and the claim command that was its last caller.
  ('task_managers',                               'p_task_id bigint, p_actor uuid',                                                                                     'none'),
  ('update_campaign_impl',                        'p_campaign_id bigint, p_name text',                                                                                  'impl'),
  -- #626: the full-state Task edit body, its preview body, and the two shared
  -- helpers both bodies read (validation/diff and the one consequence
  -- definition) -- callable only from inside those definer bodies.
  ('update_task_impl',                            'p_task_id bigint, p_title text, p_description text, p_deadline timestamp with time zone, p_campaign_id bigint, p_assignment_mode text, p_audience text, p_accept_consequences boolean', 'impl'),
  ('preview_task_update_impl',                    'p_task_id bigint, p_title text, p_description text, p_deadline timestamp with time zone, p_campaign_id bigint, p_assignment_mode text, p_audience text', 'impl'),
  ('plan_task_update',                            'p_task tasks, p_title text, p_description text, p_deadline timestamp with time zone, p_campaign_id bigint, p_assignment_mode text, p_audience text', 'none'),
  ('task_update_consequences',                    'p_task_id bigint, p_assignment_mode text, p_audience text', 'none'),
  ('update_task_content_impl',                    'p_task_id bigint, p_title text, p_description text, p_deadline timestamp with time zone, p_campaign_id bigint',        'impl'),
  -- #507: the two Group invariant triggers — the hierarchy/path/Minimum Level
  -- rules on `groups`, and the immutable-identity rule on `group_members`.
  ('validate_group_hierarchy',                    '',                                                                                                                   'trigger'),
  ('validate_group_member',                       '',                                                                                                                   'trigger'),
  ('validate_project_manager_state',              '',                                                                                                                   'trigger'),
  ('validate_project_membership_change',          '',                                                                                                                   'trigger'),
  ('validate_task_campaign',                      '',                                                                                                                   'trigger'),
  ('validate_task_hierarchy',                     '',                                                                                                                   'trigger'),
  -- #499: the body behind public.visible_task_executors(bigint[]). It reveals
  -- only the current Executor for Tasks private.can_read_task authorizes.
  ('visible_task_executors',                      'p_task_ids bigint[]',                                                                                                'authenticated_only'),
  -- #520: shared Group authority, three policy predicates and five internal helpers.
  ('group_role_of', 'p_group_id bigint, p_member uuid', 'none'),
  ('is_group_member', 'p_group_id bigint, p_member uuid', 'none'),
  ('has_group_manager', 'p_group_id bigint', 'none'),
  ('is_group_manager', 'p_group_id bigint', 'predicate'),
  ('is_group_responsible', 'p_group_id bigint', 'predicate'),
  ('can_manage_group_work', 'p_group_id bigint', 'predicate'),
  ('require_group_work_manager', 'p_group_id bigint', 'require'),
  ('group_managers', 'p_group_id bigint', 'none'),
  ('cancel_event_impl', 'p_event_id bigint, p_reason text', 'impl'),
  ('update_event_impl', 'p_event_id bigint, p_title text, p_type text, p_group_id bigint, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_location text, p_capacity integer, p_description text, p_min_level integer', 'impl'),
  ('event_notification_recipients', 'p_event_id bigint', 'none'),
  ('create_event_impl', 'p_title text, p_type text, p_group_id bigint, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_location text, p_capacity integer, p_description text, p_min_level integer', 'impl'),
  ('withdraw_task_interest_impl',                 'p_task_id bigint',                                                                                                   'impl'),
  -- #576: the live "holds a Group Role anywhere" policy helper (T8's
  -- Organization-Group compose arm), and the two read bodies behind
  -- public.my_capabilities() / public.my_groups().
  ('holds_any_group_role', '', 'predicate'),
  ('my_capabilities_impl', '', 'impl'),
  ('my_groups_impl',       '', 'impl'),
  -- #601: the Group Audience (roster rows below the Group plus Automatic
  -- Membership) behind Event and announcement fan-out. Internal only: no
  -- client role executes it, event_notification_recipients and the
  -- announcement fan-out call it as definer.
  ('group_audience', 'p_group_id bigint', 'none');

select is(
  (select count(*) from pinned_private_functions)::int, 142,
  'the audited roster includes Groups Wave 2 authority and commands, the #50 Role history guard, the #69 deadline job, #580''s two Member command bodies, #603''s session-revoke helper, #626''s update_task / preview_task_update bodies with their two shared helpers, #625''s two Campaign reporting bodies plus their shared require_* preamble, #370''s Event creation implementation, #248''s three Event edit/cancellation functions (the two implementations and the Notification recipient set), and #576''s holds_any_group_role predicate with the my_capabilities / my_groups bodies, and #601''s group_audience helper');

create function pg_temp.unpinned_private_functions() returns text[]
language sql as $$
  select coalesce(array_agg(p.proname order by p.proname), '{}')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'private'
   where not exists (
     select 1 from pinned_private_functions pin
      where pin.proname = p.proname
        and pin.args = pg_get_function_identity_arguments(p.oid)
   )
$$;

select is(pg_temp.unpinned_private_functions(), '{}'::text[],
  'no function exists in private beyond this suite''s pinned roster -- a new one must be added here, with a reasoned category, before it can ship (this is the enforcement dobrerares asked for: schema membership alone never decides a grant)');

create function pg_temp.missing_pinned_functions() returns text[]
language sql as $$
  select coalesce(array_agg(pin.proname order by pin.proname), '{}')
    from pinned_private_functions pin
   where not exists (
     select 1 from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'private'
      where p.proname = pin.proname
        and pg_get_function_identity_arguments(p.oid) = pin.args
   )
$$;

select is(pg_temp.missing_pinned_functions(), '{}'::text[],
  'every pinned private function still exists with its recorded signature (catches a silent rename or drop)');

create function pg_temp.private_category_violations() returns text[]
language sql as $$
  select coalesce(array_agg(pin.proname order by pin.proname), '{}')
    from pinned_private_functions pin
    join pg_proc p on p.proname = pin.proname
      and pg_get_function_identity_arguments(p.oid) = pin.args
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'private'
   where not (
     case
       -- impl / predicate / authenticated_only all mean the same grant:
       -- authenticated only, nobody else -- they differ in *why* (command
       -- body, RLS policy predicate, or a view/policy helper respectively),
       -- not in the grant itself.
       when pin.category in ('impl', 'predicate', 'authenticated_only') then
             not has_function_privilege('anon', p.oid, 'execute')
         and     has_function_privilege('authenticated', p.oid, 'execute')
         and not has_function_privilege('service_role', p.oid, 'execute')
         and not has_function_privilege('public', p.oid, 'execute')
       -- require_* / trigger / none (no caller yet) all mean nobody at
       -- all, not even service_role -- only the command or trigger that
       -- runs as the table owner may call these.
       when pin.category in ('require', 'trigger', 'none') then
             not has_function_privilege('anon', p.oid, 'execute')
         and not has_function_privilege('authenticated', p.oid, 'execute')
         and not has_function_privilege('service_role', p.oid, 'execute')
         and not has_function_privilege('public', p.oid, 'execute')
       else false
     end
   )
$$;

select is(pg_temp.private_category_violations(), '{}'::text[],
  'every pinned private function''s execute grant matches its category exactly -- authenticated cannot execute a require_*/trigger/not-yet-wired helper, and nothing in private is ever executable by anon or service_role');

-- ==================== 8. usage on schema private ====================

select is(has_schema_privilege('authenticated', 'private', 'usage'), true,
  'authenticated holds usage on private -- it evaluates policy predicates and calls _impl functions as itself');

select is(has_schema_privilege('anon', 'private', 'usage'), false,
  'anon has no usage on private (private is never exposed to PostgREST either way, but this is the second line of defense)');

select is(has_schema_privilege('service_role', 'private', 'usage'), false,
  'service_role has no usage on private -- every command runs as the table owner, not as service_role');

select * from finish();
rollback;
