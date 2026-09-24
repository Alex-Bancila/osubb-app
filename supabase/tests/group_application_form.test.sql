-- #697: a Group's application form link (ruling R18) -- groups.application_form_label/_url.
--
-- In the order the command answers: the schema and its three named
-- constraints (Ruling 23: every throws_ok names its constraint), the step-1
-- rules for everyone (claimless callers included), the persona matrix of
-- private.require_group_manager, the full-state replace (set, trim, change,
-- clear, nothing_to_update), and the read side -- an applicant who is on no
-- roster must see the link, since they are the one who opens it.
--
-- Mutation guards, each named against the assertion that turns red:
--   * drop groups_application_form_ck / _label_ck / _url_ck -> the direct
--     writes in section 1 stop throwing;
--   * drop the private.require_attached_link call -> section 2's claimless
--     link_incomplete becomes 42501, and the Manager's refusals become raw
--     23514 constraint errors;
--   * drop the trim -> "stored trimmed" reads the padded values;
--   * drop the link from the nothing_to_update tuple -> the first set is
--     refused as nothing_to_update;
--   * drop the link from the UPDATE's SET list -> every stored-value read fails.
--
-- Fixture Groups are inserted directly (conventions OD9: owner-run, rolled back).
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(37);

-- ==================== Fixtures ====================

create function pg_temp.g697_uid(n integer) returns uuid language sql immutable as $$
  select ('69700000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;

insert into auth.users (id, email)
select pg_temp.g697_uid(n), 'member.' || n || '.697@test.local' from generate_series(1, 7) n;

-- 1 BC, 2 Manager of the root (the ancestor Manager), 3 Manager of the child,
-- 4 Responsible of the child, 5 ordinary member of the child, 6 claimless,
-- 7 an applicant on no roster at all.
insert into public.profiles (id, full_name, email, role, status)
select pg_temp.g697_uid(n), 'Member #697 ' || n, 'member.' || n || '.697@test.local',
  (case n when 1 then 'bc' else 'voluntar' end)::public.member_role,
  'activ'::public.member_status
from generate_series(1, 7) n;

insert into public.groups (name, category, min_level, created_by)
values ('Rădăcină #697', 'department', 0, pg_temp.g697_uid(1));
insert into public.groups (name, category, min_level, automatic_membership, created_by)
values ('Automat #697', 'department', 0, true, pg_temp.g697_uid(1));

create function pg_temp.g697_group(p_name text) returns bigint
language sql stable security definer set search_path = '' as $$
  select id from public.groups where name = p_name
$$;

insert into public.groups (name, category, parent_id, min_level, created_by)
values ('Copil #697', 'team', pg_temp.g697_group('Rădăcină #697'), 0, pg_temp.g697_uid(1));

insert into public.group_members (group_id, member_id, group_role, position_title)
values (pg_temp.g697_group('Rădăcină #697'), pg_temp.g697_uid(2), 'manager',     null),
       (pg_temp.g697_group('Copil #697'),    pg_temp.g697_uid(3), 'manager',     null),
       (pg_temp.g697_group('Copil #697'),    pg_temp.g697_uid(4), 'responsible', 'Responsabil #697'),
       (pg_temp.g697_group('Copil #697'),    pg_temp.g697_uid(5), 'member',      null);

create function pg_temp.g697_bc() returns void language sql as $$
  select pg_temp.test_login(pg_temp.g697_uid(1), '{"member_role":"bc","member_level":6}'::jsonb) $$;
create function pg_temp.g697_as(n integer) returns void language sql as $$
  select pg_temp.test_login(pg_temp.g697_uid(n), '{"member_role":"voluntar","member_level":1}'::jsonb) $$;

-- The child's full operational state, with only the link varying.
create function pg_temp.g697_set(p_label text, p_url text) returns text
language sql as $$
  select format($f$select public.update_group(%s, 'Copil #697', null, false, null, false, 0, %L, %L)$f$,
                pg_temp.g697_group('Copil #697'), p_label, p_url)
$$;
create function pg_temp.g697_link(p_name text) returns text[]
language sql stable security definer set search_path = '' as $$
  select array[application_form_label, application_form_url] from public.groups where name = p_name
$$;

-- ==================== 1 · schema and the three named constraints ====================

select has_column('public', 'groups', 'application_form_label', 'groups.application_form_label exists');
select has_column('public', 'groups', 'application_form_url', 'groups.application_form_url exists');

select throws_ok(
  $$ update public.groups set application_form_label = 'Doar eticheta' where name = 'Copil #697' $$,
  '23514', 'new row for relation "groups" violates check constraint "groups_application_form_ck"',
  'groups_application_form_ck: a label without an address is refused on a direct write');
select throws_ok(
  $$ update public.groups set application_form_url = 'https://forms.example.org/a' where name = 'Copil #697' $$,
  '23514', 'new row for relation "groups" violates check constraint "groups_application_form_ck"',
  'groups_application_form_ck: an address without a label is refused on a direct write');
select throws_ok(
  $$ update public.groups set application_form_label = repeat('a', 61),
                              application_form_url = 'https://forms.example.org/a' where name = 'Copil #697' $$,
  '23514', 'new row for relation "groups" violates check constraint "groups_application_form_label_ck"',
  'groups_application_form_label_ck: a label over 60 characters is refused on a direct write');
select throws_ok(
  $$ update public.groups set application_form_label = '   ',
                              application_form_url = 'https://forms.example.org/a' where name = 'Copil #697' $$,
  '23514', 'new row for relation "groups" violates check constraint "groups_application_form_label_ck"',
  'groups_application_form_label_ck: a whitespace-only label is refused on a direct write');
select throws_ok(
  $$ update public.groups set application_form_label = 'Formular',
                              application_form_url = 'ftp://forms.example.org/a' where name = 'Copil #697' $$,
  '23514', 'new row for relation "groups" violates check constraint "groups_application_form_url_ck"',
  'groups_application_form_url_ck: a non-http(s) address is refused on a direct write');
select throws_ok(
  $$ update public.groups set application_form_label = 'Formular',
                              application_form_url = 'https://' || repeat('a', 2041) where name = 'Copil #697' $$,
  '23514', 'new row for relation "groups" violates check constraint "groups_application_form_url_ck"',
  'groups_application_form_url_ck: an address over 2048 characters is refused on a direct write');

select pg_temp.g697_bc();
select throws_ok(
  $$ update public.groups set application_form_label = 'Formular',
                              application_form_url = 'https://forms.example.org/a' where name = 'Copil #697' $$,
  '42501', 'permission denied for table groups',
  'authenticated -- even BC -- cannot write the link directly: update_group is the only write path');

-- ==================== 2 · step 1: malformed for everyone, before the gate ====================

reset role;
select pg_temp.test_login(pg_temp.g697_uid(6), '{"provider":"email"}'::jsonb);
select throws_ok(pg_temp.g697_set('Formular', null),
  'PT400', 'link_incomplete',
  'a claimless caller sending a label alone gets PT400 link_incomplete, ahead of the gate');

reset role;
select pg_temp.g697_as(3);
select throws_ok(pg_temp.g697_set(null, 'https://forms.example.org/a'),
  'PT400', 'link_incomplete',
  'an address without a label is link_incomplete');
select throws_ok(pg_temp.g697_set('Formular', '   '),
  'PT400', 'link_incomplete',
  'a whitespace-only address is blank, so a label beside it is link_incomplete');
select throws_ok(pg_temp.g697_set('Formular', 'ftp://forms.example.org/a'),
  'PT400', 'link_url_invalid',
  'an ftp:// address is link_url_invalid');
select throws_ok(pg_temp.g697_set('Formular', 'javascript:alert(1)'),
  'PT400', 'link_url_invalid',
  'a javascript: address is link_url_invalid -- only http(s) ever reaches an applicant');
select throws_ok(pg_temp.g697_set(repeat('a', 61), 'https://forms.example.org/a'),
  'PT400', 'link_label_too_long',
  'a 61-character label is link_label_too_long');
select throws_ok(pg_temp.g697_set('Formular', 'https://' || repeat('a', 2041)),
  'PT400', 'link_url_too_long',
  'a 2049-character address is link_url_too_long');
select is(pg_temp.g697_link('Copil #697'), array[null, null]::text[],
  'nothing refused above reached the row');

-- ==================== 3 · authority: private.require_group_manager ====================

reset role;
select pg_temp.test_login(pg_temp.g697_uid(6), '{"provider":"email"}'::jsonb);
select throws_ok(pg_temp.g697_set('Formular', 'https://forms.example.org/a'),
  '42501', 'group_manage_forbidden',
  'a claimless caller with a well-formed link is refused');

reset role;
select pg_temp.g697_as(5);
select throws_ok(pg_temp.g697_set('Formular', 'https://forms.example.org/a'),
  '42501', 'group_manage_forbidden',
  'an ordinary member of the Group cannot set the link');

reset role;
select pg_temp.g697_as(4);
select throws_ok(pg_temp.g697_set('Formular', 'https://forms.example.org/a'),
  '42501', 'group_manage_forbidden',
  'a Group RESPONSIBLE cannot set the link -- it is an operational setting of the Manager tier');

reset role;
select pg_temp.g697_as(7);
select throws_ok(pg_temp.g697_set('Formular', 'https://forms.example.org/a'),
  '42501', 'group_manage_forbidden',
  'a Member on no roster cannot set the link');

-- The Group's own Manager sets it, padded: stored trimmed.
reset role;
select pg_temp.g697_as(3);
select lives_ok(pg_temp.g697_set(E'  Formular de înscriere \t', E' https://forms.example.org/a\n'),
  'the Group''s own Manager sets the link through update_group');
select is(pg_temp.g697_link('Copil #697'),
  array['Formular de înscriere', 'https://forms.example.org/a'],
  'both values are stored trimmed');
select throws_ok(pg_temp.g697_set('Formular de înscriere ', ' https://forms.example.org/a'),
  'PT409', 'nothing_to_update',
  'sending the same link back (differently padded) is nothing_to_update');

-- An ancestor's Manager changes it.
reset role;
select pg_temp.g697_as(2);
select lives_ok(pg_temp.g697_set('Formular 2026', 'http://forms.example.org/b'),
  'the parent Group''s Manager changes the link (authority flows down the path)');
select is(pg_temp.g697_link('Copil #697'),
  array['Formular 2026', 'http://forms.example.org/b'],
  'the ancestor Manager''s link is stored');

-- BC clears it with a whitespace-only pair, sets it again, and clears it with nulls.
reset role;
select pg_temp.g697_bc();
select lives_ok(pg_temp.g697_set('   ', E'\t'),
  'BC sends a whitespace-only pair');
select is(pg_temp.g697_link('Copil #697'), array[null, null]::text[],
  'a whitespace-only pair is stored as no link at all');
select lives_ok(pg_temp.g697_set('Formular BC', 'https://forms.example.org/c'),
  'BC sets the link');
select lives_ok(pg_temp.g697_set(null, null),
  'BC clears the link with nulls (full-state replace: null clears)');
select is(pg_temp.g697_link('Copil #697'), array[null, null]::text[],
  'the cleared link is gone');
select throws_ok(pg_temp.g697_set(null, null),
  'PT409', 'nothing_to_update',
  'clearing a link that is already clear is nothing_to_update');

-- No coupling: an Automatic-Membership Group may store a link like any other.
select lives_ok(
  format($$select public.update_group(%s, 'Automat #697', null, false, null, false, 0, 'Formular', 'https://forms.example.org/d')$$,
         pg_temp.g697_group('Automat #697')),
  'an Automatic-Membership Group may store a link -- the setting is not tied to any Group kind');

-- ==================== 4 · the read side and the single signature ====================

reset role;
select pg_temp.g697_bc();
select lives_ok(pg_temp.g697_set('Formular public', 'https://forms.example.org/e'),
  'BC sets the link the applicant will read');
reset role;
select pg_temp.g697_as(7);
select is(
  (select array[application_form_label, application_form_url] from public.groups where name = 'Copil #697'),
  array['Formular public', 'https://forms.example.org/e'],
  'a Member on no roster reads the link under groups_read -- the applicant is the one who opens it');

reset role;
select is(
  (select count(*)::integer from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'update_group'),
  1, 'public.update_group exists under exactly one signature');
select is(
  (select count(*)::integer from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'update_group_impl'),
  1, 'private.update_group_impl exists under exactly one signature');

select * from finish();
rollback;
