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

select plan(3);

select is((select role.name from public.roles as role where role.id = 'activ'),
  'Voluntar Activ',
  'level 2 renders as Voluntar Activ — the identifier stays `activ` (ADR-0009 Ranks)');

select is((select role.name from public.roles as role where role.id = 'vot'),
  'Voluntar cu Drept de Vot',
  'level 3 renders as Voluntar cu Drept de Vot');

-- The staging seed's preflight refuses to run unless public.roles holds
-- exactly 8 rows (.github/workflows/seed-staging.yml). A rename must never
-- become an insert or a delete.
select is((select count(*) from public.roles), 8::bigint,
  'the ladder is still eight rows — this is a rename, not a change to the Role set');

select * from finish();
rollback;
