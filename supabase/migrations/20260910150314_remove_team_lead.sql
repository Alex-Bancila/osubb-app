-- #277: retire the legacy single-lead Team model without turning historical
-- leads into Team Members (and therefore granting them Team authority).
create table private.legacy_team_leads (
  team_id     text primary key references public.teams (id) on delete cascade,
  member_id   uuid not null references public.profiles (id) on delete cascade,
  archived_at timestamptz not null default statement_timestamp()
);

comment on table private.legacy_team_leads is
  'Migration snapshot only; these rows grant no Team membership or authority.';

alter table private.legacy_team_leads enable row level security;
revoke all on table private.legacy_team_leads
  from public, anon, authenticated, service_role;

-- The lock, copy, and column removal execute as one statement. A concurrent
-- legacy write therefore cannot land between the archival snapshot and DROP.
do $migration$
begin
  lock table public.teams in access exclusive mode;

  insert into private.legacy_team_leads (team_id, member_id)
  select t.id, t.lead_id
    from public.teams t
   where t.lead_id is not null;

  alter table public.teams drop column lead_id;
end
$migration$;
