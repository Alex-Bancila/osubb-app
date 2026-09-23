-- roles_display_names.test.sql — #507: `roles.name` is what every screen
-- renders, so it must read the glossary's term. ADR-0009 renames levels 2 and
-- 3 to Voluntar Activ and Voluntar cu Drept de Vot; `CONTEXT.md` recorded the
-- old values as known drift until this migration closed it. The `member_role`
-- enum identifiers (`activ`, `vot`) do not change, and neither does the size
-- of the ladder — level 4's retirement is Wave 3's.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(7);

select is((select role.name from public.roles as role where role.id = 'activ'),
  'Voluntar Activ',
  'level 2 renders as Voluntar Activ — the identifier stays `activ` (ADR-0009 Ranks)');

select is((select role.name from public.roles as role where role.id = 'vot'),
  'Voluntar cu Drept de Vot',
  'level 3 renders as Voluntar cu Drept de Vot');

select is((select count(*) from public.roles),7::bigint,'seven live ranks remain');
select is(enum_range(null::public.member_role)::text,'{recrut,voluntar,activ,vot,bce,bc,moderator}','the live enum has exactly seven values');
select ok(not exists(select 1 from public.roles where level=4),'level 4 is unused');

select is((select data_type from information_schema.columns where table_schema='public' and table_name='role_history' and column_name='from_role'),'text','audit rank names are historical text');
select lives_ok($$insert into public.role_history(member_id,from_role,to_role,changed_by,actor_kind,reason)
values('d0000000-0000-0000-0000-000000000002','responsabil','vot','d0000000-0000-0000-0000-000000000007','human','Historical rank preservation #593')$$,
 'historical audit labels remain valid without existing in the live rank enum');

select * from finish();
rollback;
