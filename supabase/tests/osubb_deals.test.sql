-- Ruling R45 (2026-10-07): OSUBB Deals. A Deal is an Announcement of kind deal,
-- posted by the OSUBB Deals team (R44: holder, Coordonator, Responsabil) from the
-- Organization Group to every active Member -- Audience org, Minimum Level 0,
-- normal, never pinned -- with an optional Deal Code. Edit/delete: holder and
-- Coordonator any Deal, the Responsabil their own, BC and the Moderator any.
-- After its Termen only the team and BC / the Moderator read it. The fan-out is
-- the organization-wide rule titled "Deal nou: <titlu>". Revealing the code is
-- recorded once per Member; the team reads the count.
--
-- Mutation proofs: see docs/backend/deals.md and the PR body.
--
-- Personas (prefix 4545):
--   1 moderator  2 bc (holder)  3 bce (Coordonator)  4 voluntar (Responsabil)
--   5 voluntar   6 bc, not in the team  7 recrut  8 vot, Manager of a Group
--   (so holds a Group Role: may post an organization-wide Announcement)
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(78);

create function pg_temp.u45(n integer) returns uuid language sql immutable as $$
  select ('45450000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
insert into auth.users(id, email)
select pg_temp.u45(n), 'deals.' || n || '.r45@test.local' from generate_series(1, 8) n;
insert into public.profiles(id, full_name, email, role, status)
select pg_temp.u45(n), 'Deals R45 ' || n, 'deals.' || n || '.r45@test.local',
       (case n when 1 then 'moderator' when 2 then 'bc' when 3 then 'bce' when 6 then 'bc'
               when 7 then 'recrut' when 8 then 'vot' else 'voluntar' end)::public.member_role,
       'activ'::public.member_status
  from generate_series(1, 8) n;
insert into public.groups(name, category, min_level) values ('Dept R45', 'department', 0);
insert into public.group_members(group_id, member_id, group_role)
select id, pg_temp.u45(8), 'manager' from public.groups where name = 'Dept R45';

delete from public.bc_assignments;
insert into public.bc_assignments(assignment, member_id, granted_by) values ('osubb_deals', pg_temp.u45(2), pg_temp.u45(1));
insert into public.assignment_team(assignment, team_role, member_id, set_by) values
  ('osubb_deals', 'coordinator', pg_temp.u45(3), pg_temp.u45(2)),
  ('osubb_deals', 'responsible', pg_temp.u45(4), pg_temp.u45(2));

create function pg_temp.org() returns bigint language sql stable security definer set search_path = '' as $$
  select id from public.groups where is_organization
$$;
create function pg_temp.dept() returns bigint language sql stable security definer set search_path = '' as $$
  select id from public.groups where name = 'Dept R45'
$$;
create function pg_temp.deal(p_title text) returns bigint language sql stable security definer set search_path = '' as $$
  select id from public.announcements where title = p_title
$$;
create function pg_temp.notified(p_title text) returns integer[] language sql stable as $$
  select coalesce(array_agg(right(member_id::text, 12)::integer order by right(member_id::text, 12)::integer), '{}')
    from public.notifications
   where title = p_title and member_id::text like '45450000-%'
$$;
grant execute on function pg_temp.u45(integer), pg_temp.org(), pg_temp.dept(), pg_temp.deal(text) to authenticated, anon;

-- Deals as fixtures (owner writes; the expired one is written in the past).
insert into public.announcements(kind, title, body, code, group_id, audience, created_by, deadline) values
  ('deal', 'Deal R45 resp', 'Corp.', 'RESP45', pg_temp.org(), 'org', pg_temp.u45(4), now() + interval '10 days'),
  ('deal', 'Deal R45 coord', 'Corp.', null,    pg_temp.org(), 'org', pg_temp.u45(3), null),
  ('deal', 'Deal R45 expirat', 'Corp.', 'EXP45', pg_temp.org(), 'org', pg_temp.u45(4), now() - interval '1 day');
insert into public.announcements(title, body, group_id, audience, created_by) values
  ('Anunt R45 org', 'Corp.', pg_temp.org(), 'org', pg_temp.u45(8));

-- ==================== Schema ====================
select col_default_is('public', 'announcements', 'kind', 'announcement',
  'an Announcement is of kind announcement unless it says deal');
select throws_ok($$insert into public.announcements(kind, title, body, group_id, audience)
  values ('promo', 'Fel R45', 'Corp.', pg_temp.org(), 'org')$$,
  '23514', 'new row for relation "announcements" violates check constraint "announcements_kind_ck"',
  'announcements_kind_ck admits only announcement and deal');

-- ==================== Insert only by the team ====================
select pg_temp.test_login_leadership(pg_temp.u45(4));
select lives_ok($$insert into public.announcements(kind, title, body, code, group_id, audience)
  values ('deal', 'Deal R45 nou', 'Corp.', '  COD45  ', pg_temp.org(), 'org')$$,
  'the Responsabil publishes a Deal');
reset role;
select is((select code from public.announcements where title = 'Deal R45 nou'), 'COD45',
  'the Deal Code is stored trimmed');
select pg_temp.test_login_leadership(pg_temp.u45(2));
select lives_ok($$insert into public.announcements(kind, title, body, group_id, audience)
  values ('deal', 'Deal R45 holder', 'Corp.', pg_temp.org(), 'org')$$, 'the holder publishes a Deal');
reset role;
select pg_temp.test_login_leadership(pg_temp.u45(3));
select lives_ok($$insert into public.announcements(kind, title, body, code, group_id, audience)
  values ('deal', 'Deal R45 c2', 'Corp.', '   ', pg_temp.org(), 'org')$$, 'the Coordonator publishes a Deal');
reset role;
select is((select code from public.announcements where title = 'Deal R45 c2'), null,
  'a blank Deal Code is no code');
select pg_temp.test_login_leadership(pg_temp.u45(5));
select throws_ok($$insert into public.announcements(kind, title, body, group_id, audience)
  values ('deal', 'Deal R45 x5', 'Corp.', pg_temp.org(), 'org')$$,
  '42501', null, 'a Voluntar outside the team cannot publish a Deal');
reset role;
select pg_temp.test_login_leadership(pg_temp.u45(6));
select throws_ok($$insert into public.announcements(kind, title, body, group_id, audience)
  values ('deal', 'Deal R45 x6', 'Corp.', pg_temp.org(), 'org')$$,
  '42501', null, 'a BC member outside the team cannot publish a Deal');
reset role;
select pg_temp.test_login_leadership(pg_temp.u45(1));
select throws_ok($$insert into public.announcements(kind, title, body, group_id, audience)
  values ('deal', 'Deal R45 x1', 'Corp.', pg_temp.org(), 'org')$$,
  '42501', null, 'the Moderator cannot publish a Deal either');
reset role;
select pg_temp.test_login_leadership(pg_temp.u45(8));
select throws_ok($$insert into public.announcements(kind, title, body, group_id, audience)
  values ('deal', 'Deal R45 x8', 'Corp.', pg_temp.org(), 'org')$$,
  '42501', null, 'a Group Manager, who may post organization-wide Announcements, cannot publish a Deal');
select lives_ok($$insert into public.announcements(title, body, group_id, audience)
  values ('Anunt R45 x8', 'Corp.', pg_temp.org(), 'org')$$,
  'the same Group Manager still posts an organization-wide Announcement (the announcement rule is unchanged)');
select throws_ok($$insert into public.announcements(title, body, code, group_id, audience)
  values ('Anunt R45 cod', 'Corp.', 'COD', pg_temp.org(), 'org')$$,
  'PT400', 'code_only_on_deals', 'an Announcement carries no Deal Code');
reset role;
select pg_temp.test_clear_jwt();
set local role authenticated;
select throws_ok($$insert into public.announcements(kind, title, body, group_id, audience)
  values ('deal', 'Deal R45 claimless', 'Corp.', pg_temp.org(), 'org')$$,
  '42501', null, 'a claimless caller cannot publish a Deal');
reset role;

-- ==================== Deal settings guard ====================
select pg_temp.test_login_leadership(pg_temp.u45(4));
select throws_ok($$insert into public.announcements(kind, title, body, group_id, audience)
  values ('deal', 'Deal R45 local', 'Corp.', pg_temp.org(), 'local')$$,
  '23514', 'invalid_deal_settings', 'a Deal is organization-wide (a local Audience is refused)');
select throws_ok($$insert into public.announcements(kind, title, body, group_id, audience)
  values ('deal', 'Deal R45 dept', 'Corp.', pg_temp.dept(), 'org')$$,
  '23514', 'invalid_deal_settings', 'a Deal is from the Organization Group (a Department is refused)');
select throws_ok($$insert into public.announcements(kind, title, body, group_id, audience, min_level)
  values ('deal', 'Deal R45 nivel', 'Corp.', pg_temp.org(), 'org', 1)$$,
  '23514', 'invalid_deal_settings', 'a Deal is for every Member, Recruți included (Minimum Level 1 is refused)');
select throws_ok($$insert into public.announcements(kind, title, body, group_id, audience, priority)
  values ('deal', 'Deal R45 critic', 'Corp.', pg_temp.org(), 'org', 'critical')$$,
  '23514', 'invalid_deal_settings', 'a Deal is never critical');
select throws_ok($$insert into public.announcements(kind, title, body, group_id, audience, pinned)
  values ('deal', 'Deal R45 fixat', 'Corp.', pg_temp.org(), 'org', true)$$,
  '23514', 'invalid_deal_settings', 'a Deal is never pinned');
select throws_ok(format($$insert into public.announcements(kind, title, body, code, group_id, audience)
  values ('deal', 'Deal R45 cod lung', 'Corp.', %L, pg_temp.org(), 'org')$$, repeat('C', 81)),
  'PT400', 'deal_code_too_long', 'a Deal Code is at most 80 characters');
select throws_ok($$update public.announcements set pinned = true where id = pg_temp.deal('Deal R45 resp')$$,
  '23514', 'invalid_deal_settings', 'an edit cannot pin a Deal');
select throws_ok($$update public.announcements set kind = 'announcement' where id = pg_temp.deal('Deal R45 resp')$$,
  '23514', 'announcement_kind_immutable', 'a Deal never becomes an Announcement');
reset role;
select pg_temp.test_login_leadership(pg_temp.u45(8));
select throws_ok($$update public.announcements set kind = 'deal' where id = pg_temp.deal('Anunt R45 org')$$,
  '23514', 'announcement_kind_immutable', 'nor an Announcement a Deal');
reset role;

-- ==================== Update / delete matrix ====================
create function pg_temp.edits(p_member integer, p_title text) returns integer language plpgsql as $$
declare v integer;
begin
  perform pg_temp.test_login_leadership(pg_temp.u45(p_member));
  with changed as (
    update public.announcements set body = 'Editat de ' || p_member
     where id = pg_temp.deal(p_title) returning 1)
  select count(*) into v from changed;
  perform set_config('role', 'postgres', true);
  return v;
end $$;
select is(pg_temp.edits(4, 'Deal R45 resp'), 1, 'the Responsabil edits their own Deal');
select is(pg_temp.edits(4, 'Deal R45 coord'), 0, 'the Responsabil cannot edit another''s Deal');
select is(pg_temp.edits(3, 'Deal R45 resp'), 1, 'the Coordonator edits any Deal');
select is(pg_temp.edits(2, 'Deal R45 coord'), 1, 'the holder edits any Deal');
select is(pg_temp.edits(6, 'Deal R45 resp'), 1, 'a BC member outside the team edits any Deal');
select is(pg_temp.edits(1, 'Deal R45 resp'), 1, 'the Moderator edits any Deal');
select is(pg_temp.edits(5, 'Deal R45 resp'), 0, 'a Voluntar cannot edit a Deal');
select is(pg_temp.edits(8, 'Deal R45 resp'), 0, 'a Group Manager cannot edit a Deal');
select is(pg_temp.edits(8, 'Anunt R45 org'), 1, 'the Group Manager still edits an organization-wide Announcement (rule unchanged)');

create function pg_temp.deletes(p_member integer, p_title text) returns integer language plpgsql as $$
declare v integer;
begin
  perform pg_temp.test_login_leadership(pg_temp.u45(p_member));
  with gone as (delete from public.announcements where id = pg_temp.deal(p_title) returning 1)
  select count(*) into v from gone;
  perform set_config('role', 'postgres', true);
  return v;
end $$;
select is(pg_temp.deletes(4, 'Deal R45 coord'), 0, 'the Responsabil cannot delete another''s Deal');
select is(pg_temp.deletes(5, 'Deal R45 coord'), 0, 'a Voluntar cannot delete a Deal');
select is(pg_temp.deletes(8, 'Deal R45 coord'), 0, 'a Group Manager cannot delete a Deal');
select is(pg_temp.deletes(4, 'Deal R45 nou'), 1, 'the Responsabil deletes their own Deal');
select is(pg_temp.deletes(3, 'Deal R45 holder'), 1, 'the Coordonator deletes another''s Deal');
select is(pg_temp.deletes(6, 'Deal R45 c2'), 1, 'a BC member outside the team deletes a Deal (a leftover after the team dissolves)');

-- ==================== Read: expiry ====================
create function pg_temp.reads(p_member integer, p_title text) returns integer language plpgsql as $$
declare v integer;
begin
  perform pg_temp.test_login_leadership(pg_temp.u45(p_member));
  select count(*) into v from public.announcements where id = pg_temp.deal(p_title);
  perform set_config('role', 'postgres', true);
  return v;
end $$;
select is(pg_temp.reads(7, 'Deal R45 resp'), 1, 'a Recrut reads an active Deal');
select is(pg_temp.reads(5, 'Deal R45 coord'), 1, 'a Deal with no Termen reads for every Member');
select is(pg_temp.reads(5, 'Deal R45 expirat'), 0, 'a Voluntar does not read a Deal past its Termen');
select is(pg_temp.reads(8, 'Deal R45 expirat'), 0, 'nor does a Group Manager outside the team');
select is(pg_temp.reads(4, 'Deal R45 expirat'), 1, 'the Responsabil still reads it');
select is(pg_temp.reads(3, 'Deal R45 expirat'), 1, 'the Coordonator still reads it');
select is(pg_temp.reads(2, 'Deal R45 expirat'), 1, 'the holder still reads it');
select is(pg_temp.reads(6, 'Deal R45 expirat'), 1, 'a BC member outside the team reads an expired Deal');
select is(pg_temp.reads(1, 'Deal R45 expirat'), 1, 'the Moderator reads an expired Deal');
select pg_temp.test_login_leadership(pg_temp.u45(5));
select throws_ok($$insert into public.announcement_reads(announcement_id, member_id)
  values (pg_temp.deal('Deal R45 expirat'), pg_temp.u45(5))$$,
  '42501', null, 'a Voluntar cannot mark an expired Deal read');
reset role;

-- ==================== Fan-out ====================
select pg_temp.test_login_leadership(pg_temp.u45(4));
insert into public.announcements(kind, title, body, group_id, audience)
  values ('deal', 'Deal R45 fan', 'Ofertă.', pg_temp.org(), 'org');
reset role;
select is(pg_temp.notified('Deal nou: Deal R45 fan'), array[3, 5, 7, 8],
  'a Deal notifies every active Member, Recruți included, as "Deal nou: <titlu>" -- no BC member or Moderator through membership, never the author');
select is((select link from public.notifications
            where title = 'Deal nou: Deal R45 fan' and member_id = pg_temp.u45(5)),
  '/anunturi/deals?deal=' || pg_temp.deal('Deal R45 fan'), 'the Notification opens the Deal on the OSUBB Deals tab');
select is((select subject from public.notifications
            where title = 'Deal nou: Deal R45 fan' and member_id = pg_temp.u45(5)),
  'announcement:' || pg_temp.deal('Deal R45 fan'), 'its subject is the Announcement''s');
select is((select count(*) from public.notifications where title = 'Anunț nou: Deal R45 fan')::int, 0,
  'a Deal is never announced as "Anunț nou"');
select pg_temp.test_login_leadership(pg_temp.u45(5));
insert into public.announcement_reads(announcement_id, member_id) values (pg_temp.deal('Deal R45 fan'), pg_temp.u45(5));
reset role;
select is((select read from public.notifications where title = 'Deal nou: Deal R45 fan' and member_id = pg_temp.u45(5)),
  true, 'reading the Deal clears its Notification');

-- ==================== The Deal Code reveal ====================
select ok(not has_function_privilege('anon', 'public.reveal_deal_code(bigint)', 'execute')
      and not has_function_privilege('anon', 'public.deal_code_reveal_count(bigint)', 'execute'),
  'anon executes neither reveal function');
select pg_temp.test_clear_jwt();
set local role authenticated;
select throws_ok($$select public.reveal_deal_code(pg_temp.deal('Deal R45 resp'))$$,
  '42501', 'deal_code_forbidden', 'a claimless caller reveals nothing');
reset role;
select pg_temp.test_login_leadership(pg_temp.u45(5));
select is(public.reveal_deal_code(pg_temp.deal('Deal R45 resp')), 'RESP45', 'a Member reveals an active Deal''s code');
select is(public.reveal_deal_code(pg_temp.deal('Deal R45 resp')), 'RESP45', 'and again, on another device');
select is((select count(*) from public.deal_code_reveals where announcement_id = pg_temp.deal('Deal R45 resp'))::int, 1,
  'the reveal is recorded once and the Member reads their own row');
select throws_ok($$select public.reveal_deal_code(pg_temp.deal('Deal R45 expirat'))$$,
  'PT404', 'deal_not_found', 'a Member cannot reveal the code of a Deal past its Termen');
select throws_ok($$select public.reveal_deal_code(pg_temp.deal('Anunt R45 org'))$$,
  'PT404', 'deal_not_found', 'an Announcement is not a Deal');
select is(public.reveal_deal_code(pg_temp.deal('Deal R45 coord')), null,
  'a Deal without a code reveals null');
select is((select count(*) from public.deal_code_reveals where announcement_id = pg_temp.deal('Deal R45 coord'))::int, 0,
  'and records nothing');
select throws_ok($$select public.deal_code_reveal_count(pg_temp.deal('Deal R45 resp'))$$,
  '42501', 'deal_code_forbidden', 'a Member outside the team does not read the reveal count');
select throws_ok($$insert into public.deal_code_reveals(announcement_id, member_id) values (pg_temp.deal('Deal R45 coord'), pg_temp.u45(5))$$,
  '42501', null, 'no direct write into deal_code_reveals');
reset role;
select pg_temp.test_login_leadership(pg_temp.u45(7));
select is(public.reveal_deal_code(pg_temp.deal('Deal R45 resp')), 'RESP45', 'a Recrut reveals it too');
select is((select count(*) from public.deal_code_reveals)::int, 1, 'and reads only their own reveal');
reset role;
select pg_temp.test_login_leadership(pg_temp.u45(4));
select is(public.deal_code_reveal_count(pg_temp.deal('Deal R45 resp')), 2, 'the Responsabil reads how many Members revealed the code');
select is(public.reveal_deal_code(pg_temp.deal('Deal R45 expirat')), 'EXP45', 'the team still reveals an expired Deal''s code');
reset role;
select pg_temp.test_login_leadership(pg_temp.u45(6));
select is(public.deal_code_reveal_count(pg_temp.deal('Deal R45 resp')), 2, 'a BC member reads the count');
select throws_ok($$select public.deal_code_reveal_count(pg_temp.deal('Anunt R45 org'))$$,
  'PT404', 'deal_not_found', 'an Announcement has no reveal count');
reset role;

-- ==================== Readers list ====================
select pg_temp.test_login_leadership(pg_temp.u45(4));
select ok((select count(*) from public.announcement_readers(pg_temp.deal('Deal R45 coord'))) > 0,
  'the Responsabil reads the readers list of any Deal');
reset role;
select pg_temp.test_login_leadership(pg_temp.u45(5));
select throws_ok($$select * from public.announcement_readers(pg_temp.deal('Deal R45 coord'))$$,
  'PT404', 'announcement_not_found', 'a Member outside the team does not');
reset role;

-- ==================== Badge ====================
create function pg_temp.badge_check(p_member integer) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.test_login_leadership(pg_temp.u45(p_member));
  select format('%s|%s|%s',
           (public.my_unread_announcements_count('deal')
             = (select count(*) from public.announcements as a
                 where a.kind = 'deal' and (a.deadline is null or a.deadline >= now())
                   and not exists (select 1 from public.announcement_reads as r
                                    where r.announcement_id = a.id and r.member_id = pg_temp.u45(p_member))))::text,
           (public.my_unread_announcements_count('announcement') + public.my_unread_announcements_count('deal')
             = public.my_unread_announcements_count())::text,
           (public.my_unread_announcements_count('deal') > 0)::text)
    into v;
  perform set_config('role', 'postgres', true);
  return v;
end $$;
select is(pg_temp.badge_check(5), 'true|true|true', 'a Voluntar''s Deals badge counts the active unread Deals; the two tabs add up to the whole badge');
select is(pg_temp.badge_check(4), 'true|true|true', 'the Responsabil, who reads the expired Deal, does not count it');

-- ==================== Daily cap ====================
select pg_temp.test_clear_jwt();
insert into public.announcements(kind, title, body, group_id, audience, created_by)
select 'deal', 'Plafon R45 ' || n, 'Corp.', pg_temp.org(), 'org', pg_temp.u45(3) from generate_series(1, 20) n;
select pg_temp.test_login_leadership(pg_temp.u45(3));
select throws_ok($$insert into public.announcements(kind, title, body, group_id, audience)
  values ('deal', 'Plafon R45 21', 'Corp.', pg_temp.org(), 'org')$$,
  'PT409', 'rate_limited', 'Deals count against the Announcement daily cap');
reset role;

-- ==================== The team dissolves, the Deals stay ====================
delete from public.bc_assignments;
select is(pg_temp.reads(4, 'Deal R45 expirat'), 0, 'once the team dissolves, the former Responsabil no longer reads an expired Deal');
select is(pg_temp.edits(4, 'Deal R45 resp'), 0, 'nor edits their own Deal');
select is(pg_temp.deletes(1, 'Deal R45 resp'), 1, 'the Moderator removes a leftover Deal');

select * from finish();
rollback;
