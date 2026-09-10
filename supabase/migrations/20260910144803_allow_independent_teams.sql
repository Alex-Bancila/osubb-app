-- #276: Teams may be independent of Departments.
--
-- The initial schema already permits NULL. This additive migration explicitly
-- records that contract at the issue boundary without rewriting history.
alter table public.teams
  alter column dept_id drop not null;

comment on column public.teams.dept_id is
  'Parent Department for a Department Team; NULL identifies an Independent Team.';
