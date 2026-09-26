-- #67: cross-role boundaries across Group visibility, work commands and rosters.
-- Native fixtures roll back; no legacy mirror, rank-4 persona or seed-dependent count.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(31);

create function pg_temp.u67(n integer) returns uuid language sql immutable as $$
  select ('67000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
insert into auth.users(id, email)
select pg_temp.u67(n), 'member.' || n || '.67@test.local' from generate_series(1, 7) n;
-- All authority personas have the same organizational Role. Only Group Roles differ.
insert into profiles(id, full_name, email, role, status)
select pg_temp.u67(n), 'Member #67 ' || n, 'member.' || n || '.67@test.local',
  case when n = 7 then 'vot'::member_role else 'voluntar'::member_role end, 'activ'
from generate_series(1, 7) n;
insert into groups(name, category, shared_work_visibility) values
  ('Private #67', 'team', false), ('Shared #67', 'team', true);
insert into groups(name, category, parent_id)
select 'Child #67', 'team', id from groups where name = 'Private #67';
insert into groups(name, category, parent_id)
select 'Grandchild #67', 'team', id from groups where name = 'Child #67';
insert into groups(name, category, min_level, application_level)
values ('Restricted #67', 'team', 3, 3);
create temp table groups67 as select id, name from groups where name like '% #67';
grant select on groups67 to authenticated;
create function pg_temp.g67(p_name text) returns bigint language sql stable as $$
  select id from pg_temp.groups67 where name = p_name || ' #67'
$$;
insert into group_members(group_id, member_id, group_role)
select pg_temp.g67(g), pg_temp.u67(n), r from (values
  ('Private', 1, 'manager'), ('Private', 2, 'responsible'),
  ('Private', 3, 'responsible'), ('Private', 4, 'member'), ('Private', 5, 'member'),
  ('Shared', 1, 'manager'), ('Shared', 4, 'member'), ('Shared', 5, 'member'),
  -- An ordinary Member at the Minimum Level: a Group Role would bypass the gate.
  ('Grandchild', 5, 'member'), ('Restricted', 7, 'member')
) as roster(g, n, r);

create temp table tasks67(name text primary key, id bigint);
grant select on tasks67 to authenticated;
-- Owner-only fixture construction; assertions exercise RLS and public commands.
create function pg_temp.task67(p_name text, p_group text, p_executor integer)
returns void language plpgsql as $$
declare v_id bigint;
begin
  insert into public.tasks(title, group_id, created_by, deadline, status, audience, assignment_mode)
  values (p_name || ' #67', pg_temp.g67(p_group), pg_temp.u67(1),
    now() - interval '1 day', 'todo', 'local', 'direct') returning id into v_id;
  insert into public.task_assignments(task_id, member_id, assigned_by)
  values (v_id, pg_temp.u67(p_executor), pg_temp.u67(1));
  insert into pg_temp.tasks67 values (p_name, v_id);
end;
$$;
select pg_temp.task67('private-peer', 'Private', 5);
select pg_temp.task67('shared-peer', 'Shared', 5);
select pg_temp.task67('manager', 'Private', 1);
select pg_temp.task67('responsible', 'Private', 3);
select pg_temp.task67('descendant', 'Grandchild', 5);
create function pg_temp.t67(p_name text) returns bigint language sql stable as $$
  select id from pg_temp.tasks67 where name = p_name
$$;
-- A local Opportunity: since ruling R26 (#794) an `org` one is visible to every
-- active Member whatever the Minimum Level, which the org-control below proves.
insert into tasks(title, group_id, created_by, deadline, status, audience, assignment_mode, queue_opened_at)
values ('Opportunity #67', pg_temp.g67('Restricted'), pg_temp.u67(1),
  now() + interval '1 day', 'todo', 'local', 'public', now());
insert into tasks67 select 'opportunity', id from tasks where title = 'Opportunity #67';
insert into events(title, type, group_id, min_level, starts_at, ends_at, created_by)
values ('Event #67', 'sedinta', pg_temp.g67('Restricted'), 3,
  now() + interval '1 day', now() + interval '2 days', pg_temp.u67(1));

-- The same pair of ordinary Members, with the visibility setting alone differing.
select pg_temp.test_login_leadership(pg_temp.u67(4));
select is((select count(*) from tasks where id = pg_temp.t67('private-peer')),
  0::bigint, 'ordinary Member cannot read a peer Task without Shared Work Visibility');
select is((select count(*) from tasks where id = pg_temp.t67('shared-peer')),
  1::bigint, 'the same ordinary Member reads the same peer work with Shared Work Visibility');
select throws_ok($$select public.cancel_task(pg_temp.t67('shared-peer'), 'No authority')$$,
  '42501', 'task_manage_forbidden', 'shared visibility grants no management authority');
reset role;

-- A Responsible cannot manage or evaluate either a Manager or another Responsible.
select pg_temp.test_login_leadership(pg_temp.u67(2));
select throws_ok($$select public.cancel_task(pg_temp.t67('manager'), 'No authority')$$,
  '42501', 'task_manage_forbidden', 'Responsible cannot manage a Group Manager Task');
select throws_ok($$select public.mark_task_unfulfilled(pg_temp.t67('manager'), 3, 3, 'Review')$$,
  '42501', 'task_evaluate_forbidden', 'Responsible cannot evaluate a Group Manager Task');
select throws_ok($$select public.cancel_task(pg_temp.t67('responsible'), 'No authority')$$,
  '42501', 'task_manage_forbidden', 'Responsible cannot manage a peer Responsible Task');
select throws_ok($$select public.mark_task_unfulfilled(pg_temp.t67('responsible'), 3, 3, 'Review')$$,
  '42501', 'task_evaluate_forbidden', 'Responsible cannot evaluate a peer Responsible Task');
-- Positive controls ensure the same valid calls reach the authority boundary.
select lives_ok($$select public.cancel_task(pg_temp.t67('private-peer'), 'Ordinary work')$$,
  'Responsible can manage ordinary Member work');
reset role;

-- Two generations of inheritance, with no explicit descendant membership.
select pg_temp.test_login_leadership(pg_temp.u67(1));
select is((select count(*) from tasks where id = pg_temp.t67('descendant')),
  1::bigint, 'ancestor Group Manager reads a grandchild Task');
select is((select count(*) from group_members where group_id = pg_temp.g67('Grandchild')),
  1::bigint, 'ancestor Group Manager reads a grandchild roster');
select lives_ok($$select public.add_group_member(pg_temp.g67('Grandchild'), pg_temp.u67(6))$$,
  'ancestor Group Manager appoints a grandchild Member');
select is((select count(*) from group_members where group_id = pg_temp.g67('Grandchild') and member_id = pg_temp.u67(6)),
  1::bigint, 'the inherited roster command actually adds the Member');
select lives_ok($$select public.mark_task_unfulfilled(pg_temp.t67('descendant'), 3, 3, 'Reviewed by ancestor')$$,
  'ancestor Group Manager evaluates a grandchild Task');
select is((select status::text from tasks where id = pg_temp.t67('descendant')),
  'unfulfilled', 'the inherited evaluation actually changes the Task');
select lives_ok($$select public.cancel_task(pg_temp.t67('manager'), 'Manager decision')$$,
  'Group Manager may manage their own Task');
select lives_ok($$select public.mark_task_unfulfilled(pg_temp.t67('responsible'), 3, 3, 'Manager review')$$,
  'Group Manager may evaluate the Responsible Task refused above');
reset role;

-- Below Minimum Level: Group, Opportunity and Event must disappear together.
select pg_temp.test_login_leadership(pg_temp.u67(4));
select is((select count(*) from groups where id = pg_temp.g67('Restricted')),
  0::bigint, 'below-Minimum-Level Member cannot discover the Group');
select is((select count(*) from tasks where id = pg_temp.t67('opportunity')),
  0::bigint, 'below-Minimum-Level Member cannot discover the Group''s local Opportunity');
select is((select count(*) from events where title = 'Event #67'),
  0::bigint, 'below-Minimum-Level Member cannot discover the Group Event');
select throws_ok($$select public.express_task_interest(pg_temp.t67('opportunity'))$$,
  'PT404', 'task_not_found', 'knowing the hidden Opportunity id does not bypass Minimum Level');
reset role;
-- Positive controls rule out absent fixtures or invalid Event instants.
select pg_temp.test_login_leadership(pg_temp.u67(7));
select is((select count(*) from groups where id = pg_temp.g67('Restricted')),
  1::bigint, 'ordinary Member at Minimum Level sees the Group');
select is((select count(*) from tasks where id = pg_temp.t67('opportunity')),
  1::bigint, 'ordinary Member at Minimum Level sees the Group''s local Opportunity');
select is((select count(*) from events where title = 'Event #67'),
  1::bigint, 'ordinary Member at Minimum Level sees the future Event');
reset role;
-- R26 (#794): an organization-wide Opportunity leaves the Minimum Level gate.
update tasks set audience = 'org' where id = pg_temp.t67('opportunity');
select pg_temp.test_login_leadership(pg_temp.u67(4));
select is((select count(*) from tasks where id = pg_temp.t67('opportunity')),
  1::bigint, 'an organization-wide Opportunity reaches a Member below the Minimum Level (R26)');
select is((select count(*) from events where title = 'Event #67'),
  0::bigint, 'the organization-wide Opportunity does not expose the Group Event');
reset role;

-- Live inactivity defeats a stale Manager token; the global claimless sweep
-- remains the sole table-wide claimless audit, so it is not duplicated here.
update profiles set status = 'inactiv' where id = pg_temp.u67(1);
select pg_temp.test_login(pg_temp.u67(1), '{"member_role":"voluntar","member_level":1}'::jsonb);
select throws_ok($$select public.add_group_member(pg_temp.g67('Grandchild'), pg_temp.u67(4))$$,
  '42501', 'group_manage_forbidden', 'inactive ancestor Manager cannot appoint with stale claims');
select throws_ok($$select public.cancel_task(pg_temp.t67('shared-peer'), 'Stale authority')$$,
  '42501', 'task_command_forbidden', 'inactive Manager cannot manage work with stale claims');
reset role;
select pg_temp.test_clear_jwt();
set local role authenticated;
select throws_ok($$select public.cancel_task(pg_temp.t67('shared-peer'), 'No membership')$$,
  '42501', 'task_command_forbidden', 'claimless session cannot manage work');
select throws_ok($$select public.add_group_member(pg_temp.g67('Grandchild'), pg_temp.u67(4))$$,
  '42501', 'group_manage_forbidden', 'claimless session cannot appoint');
reset role;
set local role anon;
select throws_ok($$select public.cancel_task(1, 'Anonymous')$$,
  '42501', 'permission denied for function cancel_task', 'anonymous caller cannot execute Task commands');
select throws_ok($$select public.add_group_member(1, '67000000-0000-0000-0000-000000000004')$$,
  '42501', 'permission denied for function add_group_member', 'anonymous caller cannot execute roster commands');
reset role;
select * from finish();
rollback;
