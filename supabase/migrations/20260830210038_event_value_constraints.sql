-- #244: keep invalid calendar values out of every write path, including SQL,
-- PostgREST, and the manager commands introduced after this migration.

-- A composite foreign key is the durable way to guarantee that a team event
-- carries that team's real department. PostgreSQL CHECK constraints must not
-- query other rows or tables.
alter table public.teams
  add constraint teams_id_dept_unique unique (id, dept_id);

alter table public.events
  drop constraint events_team_id_fkey,
  add constraint events_team_department_fkey
    foreign key (team_id, dept_id)
    references public.teams (id, dept_id);

-- The original interval constraint allowed equal instants and nullable start
-- times. Upcoming events need a real start, while an omitted end remains valid
-- for deadlines and other point-in-time entries.
alter table public.events
  drop constraint events_interval_ck,
  alter column starts_at set not null,
  add constraint events_title_not_blank_ck
    check (title ~ '[^[:space:]]'),
  add constraint events_interval_ck
    check (ends_at is null or ends_at > starts_at),
  add constraint events_capacity_positive_ck
    check (capacity is null or capacity > 0),
  add constraint events_scope_fields_ck
    check (
         (scope = 'org'     and dept_id is null     and team_id is null)
      or (scope = 'dept'    and dept_id is not null and team_id is null)
      or (scope = 'team'    and dept_id is not null and team_id is not null)
      or (scope = 'project' and dept_id is null     and team_id is null)
    );
