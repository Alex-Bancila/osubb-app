-- evaluation_settings.test.sql — R58 (Alex, 2026-10-18), part 2: the one row of
-- evaluation settings (Prag minim, Data limită de intrare, Data de început a
-- punctajului) and the change log that holds dates. Spec
-- docs/superpowers/specs/2026-10-18-portofoliu-interne-design.md, section B.
-- Covers the table (singleton, the Floor's range, no value on day one, the
-- trigger set, the read policy and the absence of a client write path) and the
-- widened public.promotion_threshold_changes (the three new fields, the date
-- pair, the `migration` source and the shapes that keep a date row and a
-- number row apart). The three commands and points_floor() have their own
-- suite (evaluation_settings_commands.test.sql).
-- Runs in one transaction and rolls back.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(56);

-- ==================== Fixtures — prefix 58582000-… ====================
-- 1 bc; 2 voluntar; 3 deactivated voluntar holding a still-valid token.

create function pg_temp.u582(n integer) returns uuid language sql immutable as $$
  select ('58582000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;

insert into auth.users (id, email) values
  (pg_temp.u582(1), 'bc.582@test.local'),
  (pg_temp.u582(2), 'voluntar.582@test.local'),
  (pg_temp.u582(3), 'stale.582@test.local');
insert into public.profiles (id, full_name, email, role, status) values
  (pg_temp.u582(1), 'BC 582',                  'bc.582@test.local',        'bc',       'activ'),
  (pg_temp.u582(2), 'Voluntar 582',            'voluntar.582@test.local',  'voluntar', 'activ'),
  (pg_temp.u582(3), 'Voluntar dezactivat 582', 'stale.582@test.local',     'voluntar', 'inactiv');

-- A Role Evaluation to name in a log row, written as the owner (the command
-- that writes one has its own suite).
insert into public.role_evaluations
  (kind, name, period_from, period_to, run_by, threshold_used, threshold_computed, ranked_count)
values ('voluntar_activ', 'Evaluare 582', '2028-01-01', '2028-01-31', pg_temp.u582(1), 30, 25, 10);

create temp table fx582 as
  select (select id from public.role_evaluations where name = 'Evaluare 582') as re1;

-- ==================== 1. The table ====================

select has_table('public', 'evaluation_settings', 'public.evaluation_settings exists');
select col_is_pk('public', 'evaluation_settings', 'id', 'id is the primary key');
select is((select relrowsecurity from pg_class where oid = 'public.evaluation_settings'::regclass), true,
  'evaluation_settings has RLS enabled in the migration that creates it (house rule 2)');
select columns_are('public', 'evaluation_settings',
  array['id', 'eligibility_floor', 'membership_cutoff', 'points_start_date',
        'created_at', 'updated_at', 'updated_by'],
  'the row holds the three settings, its timestamps and who last changed it');
select is(
  (select count(*) from pg_attribute as attribute
     where attribute.attrelid = 'public.evaluation_settings'::regclass
       and attribute.attnum > 0 and not attribute.attisdropped
       and col_description(attribute.attrelid, attribute.attnum) is null),
  0::bigint,
  'every column carries a comment');
select matches(obj_description('public.evaluation_settings'::regclass, 'pg_class'), 'R58',
  'the table comment names ruling R58');
select has_trigger('public', 'evaluation_settings', 'evaluation_settings_set_updated_at',
  'evaluation_settings_set_updated_at maintains updated_at');
select has_trigger('public', 'evaluation_settings', 'broadcast_change',
  'the row broadcasts its changes (ADR-0011) -- it is not on the live-changes exclusion list');
select has_index('public', 'evaluation_settings', 'evaluation_settings_updated_by_idx', array['updated_by'],
  'updated_by is indexed');

-- ==================== 2. One row, no value on day one ====================

select is((select count(*) from public.evaluation_settings), 1::bigint,
  'exactly one row exists after the migrations');
select is((select id from public.evaluation_settings), 1::smallint, 'and it is row 1');

-- The suite must not depend on what the database committed: put the row as the
-- migration seeded it (rolled back with the transaction), then judge it.
update public.evaluation_settings
   set eligibility_floor = null, membership_cutoff = null, points_start_date = null, updated_by = null
 where id = 1;
select results_eq(
  $$ select eligibility_floor, membership_cutoff, points_start_date, updated_by
       from public.evaluation_settings $$,
  $$ values (null::integer, null::date, null::date, null::uuid) $$,
  'the Prag minim, the Data limită de intrare and the Data de început a punctajului are all unset until BC sets them');
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'evaluation_settings'
      and column_name in ('eligibility_floor', 'membership_cutoff', 'points_start_date')
      and column_default is not null),
  0,
  'and none of the three values has a column default, so the row stays unset until BC sets them');

select throws_ok(
  $$ insert into public.evaluation_settings (id) values (2) $$,
  '23514', 'new row for relation "evaluation_settings" violates check constraint "evaluation_settings_singleton_ck"',
  'evaluation_settings_singleton_ck: there is only ever row 1');
select throws_ok(
  $$ update public.evaluation_settings set eligibility_floor = 0 $$,
  '23514', 'new row for relation "evaluation_settings" violates check constraint "evaluation_settings_floor_ck"',
  'evaluation_settings_floor_ck: the Prag minim is at least 1, so a computed line is always a legal threshold');
select throws_ok(
  $$ update public.evaluation_settings set eligibility_floor = -3 $$,
  '23514', 'new row for relation "evaluation_settings" violates check constraint "evaluation_settings_floor_ck"',
  'evaluation_settings_floor_ck: and never negative');
select lives_ok(
  $$ update public.evaluation_settings
        set eligibility_floor = 1, membership_cutoff = '2026-09-01', points_start_date = '2026-10-01' $$,
  'a Prag minim of 1 and two dates are accepted');
select ok(
  (select updated_at > created_at from public.evaluation_settings),
  'the updated_at trigger stamps an edit');
update public.evaluation_settings
   set eligibility_floor = null, membership_cutoff = null, points_start_date = null;

-- ==================== 3. Grants and read personas ====================

select is(
  array[has_table_privilege('authenticated', 'public.evaluation_settings', 'select'),
        has_table_privilege('authenticated', 'public.evaluation_settings', 'insert'),
        has_table_privilege('authenticated', 'public.evaluation_settings', 'update'),
        has_table_privilege('authenticated', 'public.evaluation_settings', 'delete')],
  array[true, false, false, false],
  'authenticated may select evaluation_settings and nothing else -- the commands are the write path');
select is(
  array[has_table_privilege('anon', 'public.evaluation_settings', 'select'),
        has_table_privilege('anon', 'public.evaluation_settings', 'insert')],
  array[false, false],
  'anon holds no privilege on evaluation_settings');
select is(
  array[has_table_privilege('service_role', 'public.evaluation_settings', 'select'),
        has_table_privilege('service_role', 'public.evaluation_settings', 'insert'),
        has_table_privilege('service_role', 'public.evaluation_settings', 'update'),
        has_table_privilege('service_role', 'public.evaluation_settings', 'delete')],
  array[true, false, false, false],
  'service_role may select evaluation_settings and nothing else');
select is(
  (select array_agg(policyname || ':' || cmd order by policyname)::text[] from pg_policies
    where schemaname = 'public' and tablename = 'evaluation_settings'),
  array['evaluation_settings_read:SELECT'],
  'the only policy is evaluation_settings_read, for select -- no client write policy exists');

select pg_temp.test_login_leadership(pg_temp.u582(2));
select is((select count(*) from public.evaluation_settings), 1::bigint,
  'a Voluntar (level 1) with organization claims reads the row -- a Member may know the rules of their own promotion');
select throws_ok(
  $$ update public.evaluation_settings set eligibility_floor = 5 $$,
  '42501', 'permission denied for table evaluation_settings',
  'and cannot write it');
reset role;

select pg_temp.test_login_leadership(pg_temp.u582(1));
select throws_ok(
  $$ update public.evaluation_settings set points_start_date = '2026-10-01' $$,
  '42501', 'permission denied for table evaluation_settings',
  'BC cannot write it by a direct update either');
reset role;

select pg_temp.test_login(pg_temp.u582(2), '{}'::jsonb);
select is((select count(*) from public.evaluation_settings), 0::bigint,
  'a claimless session with a real uid reads nothing (house rule 12)');
reset role;

select pg_temp.test_login(pg_temp.u582(3), jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1,
  'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb, 'group_ids', '[]'::jsonb));
select is((select count(*) from public.evaluation_settings), 0::bigint,
  'a deactivated Member''s still-valid token reads nothing -- the gate reads the live Profile');
reset role;

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok($$ select count(*) from public.evaluation_settings $$, '42501', null,
  'anon cannot read evaluation_settings at all');
reset role;

-- ==================== 4. The change log holds dates ====================

select columns_are('public', 'promotion_threshold_changes',
  array['id', 'kind', 'from_value', 'to_value', 'source', 'changed_by', 'role_evaluation_id',
        'changed_at', 'field', 'promotion_rule_id', 'from_date', 'to_date'],
  'the log gains a from_date and a to_date for the two date fields');
select col_is_null('public', 'promotion_threshold_changes', 'to_value',
  'to_value is nullable: a date change has no number');
select col_type_is('public', 'promotion_threshold_changes', 'to_date', 'date',
  'to_date is a date');

-- Valid rows of every new shape.
select lives_ok(
  format($$ insert into public.promotion_threshold_changes (field, from_value, to_value, source, changed_by)
            values ('floor', null, 5, 'manual', %L), ('floor', 5, 8, 'manual', %L) $$,
         pg_temp.u582(1), pg_temp.u582(1)),
  'a Prag minim change is logged with numbers');
select lives_ok(
  format($$ insert into public.promotion_threshold_changes (field, from_date, to_date, source, changed_by)
            values ('cutoff', null, '2026-09-01', 'manual', %L),
                   ('points_start', '2026-10-01', '2026-11-01', 'manual', %L) $$,
         pg_temp.u582(1), pg_temp.u582(1)),
  'a Data limită de intrare and a Data de început a punctajului change are logged with dates');
select lives_ok(
  $$ insert into public.promotion_threshold_changes (field, from_date, to_date, source)
     values ('points_start', null, '2026-10-01', 'migration') $$,
  'a migration''s own write names neither a Member nor a run');
select lives_ok(
  format($$ insert into public.promotion_threshold_changes (kind, field, from_value, to_value, source, role_evaluation_id)
            values ('voluntar_activ', 'threshold', 30, 25, 'role_evaluation', %s) $$,
         (select re1 from fx582)),
  'a run''s hand-over of a threshold still logs as before');
-- The new sources reach the shares and the settings a finalised run writes.
select lives_ok(
  $$ insert into public.promotion_threshold_changes (kind, field, from_value, to_value, source)
     values ('voluntar_activ', 'percent', 40, 35, 'migration'),
            ('adunarea_generala', 'percent', 30, 25, 'migration') $$,
  'the day-one change of the shares is a migration''s: percent_shape_ck no longer demands source manual');
select lives_ok(
  format($$ insert into public.promotion_threshold_changes (kind, field, from_value, to_value, source, role_evaluation_id)
            values ('voluntar_activ', 'percent', 35, 40, 'role_evaluation', %s) $$,
         (select re1 from fx582)),
  'a finalised run writes the share it used through: a percent row of source role_evaluation names its run');
select lives_ok(
  format($$ insert into public.promotion_threshold_changes (field, from_value, to_value, source, role_evaluation_id)
            values ('floor', 5, 8, 'role_evaluation', %s) $$,
         (select re1 from fx582)),
  'and the Prag minim it used');
select lives_ok(
  format($$ insert into public.promotion_threshold_changes (field, from_date, to_date, source, role_evaluation_id)
            values ('cutoff', '2026-09-01', '2026-09-15', 'role_evaluation', %s) $$,
         (select re1 from fx582)),
  'and the Data limită de intrare');

-- Each refusal names its constraint (conventions section 8, ruling 23).
select throws_ok(
  format($$ insert into public.promotion_threshold_changes (field, to_value, to_date, source, changed_by)
            values ('cutoff', 5, '2026-09-01', 'manual', %L) $$, pg_temp.u582(1)),
  '23514', 'new row for relation "promotion_threshold_changes" violates check constraint "promotion_threshold_changes_date_shape_ck"',
  'promotion_threshold_changes_date_shape_ck: a cutoff row carries no number');
select throws_ok(
  format($$ insert into public.promotion_threshold_changes (field, from_value, to_date, source, changed_by)
            values ('points_start', 4, '2026-10-01', 'manual', %L) $$, pg_temp.u582(1)),
  '23514', 'new row for relation "promotion_threshold_changes" violates check constraint "promotion_threshold_changes_date_shape_ck"',
  'promotion_threshold_changes_date_shape_ck: nor does a points_start row carry a number before');
select throws_ok(
  format($$ insert into public.promotion_threshold_changes (field, from_date, source, changed_by)
            values ('cutoff', '2026-08-01', 'manual', %L) $$, pg_temp.u582(1)),
  '23514', 'new row for relation "promotion_threshold_changes" violates check constraint "promotion_threshold_changes_date_shape_ck"',
  'promotion_threshold_changes_date_shape_ck: a date row always names the date it moved to');
select throws_ok(
  format($$ insert into public.promotion_threshold_changes (field, to_value, to_date, source, changed_by)
            values ('floor', 5, '2026-09-01', 'manual', %L) $$, pg_temp.u582(1)),
  '23514', 'new row for relation "promotion_threshold_changes" violates check constraint "promotion_threshold_changes_date_shape_ck"',
  'promotion_threshold_changes_date_shape_ck: a floor row carries no date');
select throws_ok(
  format($$ insert into public.promotion_threshold_changes (field, from_date, to_value, source, changed_by)
            values ('floor', '2026-09-01', 5, 'manual', %L) $$, pg_temp.u582(1)),
  '23514', 'new row for relation "promotion_threshold_changes" violates check constraint "promotion_threshold_changes_date_shape_ck"',
  'promotion_threshold_changes_date_shape_ck: nor a from_date');
select throws_ok(
  format($$ insert into public.promotion_threshold_changes (kind, field, from_value, source, role_evaluation_id)
            values ('voluntar_activ', 'threshold', 30, 'role_evaluation', %s) $$, (select re1 from fx582)),
  '23514', 'new row for relation "promotion_threshold_changes" violates check constraint "promotion_threshold_changes_date_shape_ck"',
  'promotion_threshold_changes_date_shape_ck: a number row still needs its to_value, now that the column is nullable');
select throws_ok(
  format($$ insert into public.promotion_threshold_changes (field, to_value, source, changed_by)
            values ('floor', 0, 'manual', %L) $$, pg_temp.u582(1)),
  '23514', 'new row for relation "promotion_threshold_changes" violates check constraint "promotion_threshold_changes_to_value_range_ck"',
  'promotion_threshold_changes_to_value_range_ck: a Prag minim row is at least 1, as a threshold row is');
select throws_ok(
  format($$ insert into public.promotion_threshold_changes (kind, field, to_value, source, changed_by)
            values ('voluntar_activ', 'floor', 5, 'manual', %L) $$, pg_temp.u582(1)),
  '23514', 'new row for relation "promotion_threshold_changes" violates check constraint "promotion_threshold_changes_subject_ck"',
  'promotion_threshold_changes_subject_ck: a Prag minim change belongs to neither a kind nor a Promotion Rule');
select throws_ok(
  format($$ insert into public.promotion_threshold_changes (kind, field, from_date, to_date, source, changed_by)
            values ('voluntar_activ', 'cutoff', null, '2026-09-01', 'manual', %L) $$, pg_temp.u582(1)),
  '23514', 'new row for relation "promotion_threshold_changes" violates check constraint "promotion_threshold_changes_subject_ck"',
  'promotion_threshold_changes_subject_ck: nor does a date change');
select throws_ok(
  format($$ insert into public.promotion_threshold_changes (field, to_value, source, changed_by, promotion_rule_id)
            values ('floor', 5, 'manual', %L, (select min(id) from public.promotion_rules)) $$, pg_temp.u582(1)),
  '23514', 'new row for relation "promotion_threshold_changes" violates check constraint "promotion_threshold_changes_subject_ck"',
  'promotion_threshold_changes_subject_ck: nor does it name a Promotion Rule');
select throws_ok(
  format($$ insert into public.promotion_threshold_changes (field, to_value, source, changed_by)
            values ('bogus', 5, 'manual', %L) $$, pg_temp.u582(1)),
  '23514', 'new row for relation "promotion_threshold_changes" violates check constraint "promotion_threshold_changes_field_ck"',
  'promotion_threshold_changes_field_ck: the field is one of the seven');
select throws_ok(
  format($$ insert into public.promotion_threshold_changes (field, to_value, source, changed_by)
            values ('floor', 5, 'run', %L) $$, pg_temp.u582(1)),
  '23514', 'new row for relation "promotion_threshold_changes" violates check constraint "promotion_threshold_changes_source_ck"',
  'promotion_threshold_changes_source_ck: a run is source role_evaluation; there is no source "run"');
select throws_ok(
  format($$ insert into public.promotion_threshold_changes (field, from_date, to_date, source, role_evaluation_id)
            values ('points_start', null, '2026-10-01', 'role_evaluation', %s) $$, (select re1 from fx582)),
  '23514', 'new row for relation "promotion_threshold_changes" violates check constraint "promotion_threshold_changes_points_start_source_ck"',
  'promotion_threshold_changes_points_start_source_ck: a run never writes the Data de început a punctajului');
select throws_ok(
  $$ insert into public.promotion_threshold_changes (kind, field, to_value, source)
     values ('voluntar_activ', 'percent', 101, 'migration') $$,
  '23514', 'new row for relation "promotion_threshold_changes" violates check constraint "promotion_threshold_changes_percent_shape_ck"',
  'promotion_threshold_changes_percent_shape_ck: a migration''s share is still a whole 1-100');
select throws_ok(
  format($$ insert into public.promotion_threshold_changes (field, to_value, source, changed_by)
            values ('floor', 5, 'migration', %L) $$, pg_temp.u582(1)),
  '23514', 'new row for relation "promotion_threshold_changes" violates check constraint "promotion_threshold_changes_source_shape_ck"',
  'promotion_threshold_changes_source_shape_ck: a migration is not a Member');
select throws_ok(
  format($$ insert into public.promotion_threshold_changes (field, to_value, source, role_evaluation_id)
            values ('floor', 5, 'migration', %s) $$, (select re1 from fx582)),
  '23514', 'new row for relation "promotion_threshold_changes" violates check constraint "promotion_threshold_changes_source_shape_ck"',
  'promotion_threshold_changes_source_shape_ck: nor does it name a run');
select throws_ok(
  $$ insert into public.promotion_threshold_changes (field, to_value, source)
     values ('floor', 5, 'manual') $$,
  '23514', 'new row for relation "promotion_threshold_changes" violates check constraint "promotion_threshold_changes_source_shape_ck"',
  'promotion_threshold_changes_source_shape_ck: a hand edit still names its author');

select * from finish();
rollback;
