-- R58 (Alex, 2026-10-18; spec docs/superpowers/specs/2026-10-18-portofoliu-interne-design.md,
-- section B): the evaluation settings -- the Prag minim (Eligibility Floor),
-- the Data limită de intrare (Membership Cutoff Date) and the Data de început a
-- punctajului (Points Start Date) -- as one row BC and the Moderator will set
-- from the app instead of by migration, and the change log that holds the two
-- date-valued ones.
--
-- Sections:
--   1. public.evaluation_settings: the singleton row, unset on day one.
--   2. public.promotion_threshold_changes learns the three new fields, a pair
--      of date columns and the `migration` source, and its share rule admits
--      the writes of a migration and of a run.
--   3. The three commands that set the values (set_eligibility_floor,
--      set_membership_cutoff, set_points_start_date, each a wrapper over a
--      private _impl) and private.points_floor(), the instant the Points
--      Start Date begins.
--
-- The row is reference data seeded here (house rule 6), never by seed.sql.
-- Nothing reads the three values yet; the readers that apply them follow.

-- ---------------------------------------------------------------------------
-- 1. The settings row.
-- ---------------------------------------------------------------------------
create table public.evaluation_settings (
  id                smallint primary key,
  eligibility_floor integer,
  membership_cutoff date,
  points_start_date date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles (id),
  constraint evaluation_settings_singleton_ck check (id = 1),
  -- At least 1, so the line a run computes -- the Task Points of the last
  -- Member inside the share, itself at or above the Floor -- is always a legal
  -- promotion_thresholds.threshold (promotion_thresholds_threshold_range_ck).
  constraint evaluation_settings_floor_ck
    check (eligibility_floor is null or eligibility_floor >= 1),
  constraint evaluation_settings_updated_at_ck check (updated_at >= created_at)
);

alter table public.evaluation_settings enable row level security;

create trigger evaluation_settings_set_updated_at
before update on public.evaluation_settings
for each row execute function private.set_updated_at();

-- ADR-0011: a domain table broadcasts its changes (the Portofoliu Interne page
-- and the Member-facing totals refetch on the signal).
create trigger broadcast_change after insert or update or delete on public.evaluation_settings
  for each statement execute function private.broadcast_change();

-- Every foreign key is indexed (advisor_findings.test.sql).
create index evaluation_settings_updated_by_idx on public.evaluation_settings (updated_by);

-- The one row, with no value in it: BC sets the three values from the app.
insert into public.evaluation_settings (id) values (1);

comment on table public.evaluation_settings is
  'R58 (section B): the one row of evaluation settings BC or the Moderator sets from the app -- eligibility_floor (Eligibility Floor, Prag minim), membership_cutoff (Membership Cutoff Date, Data limită de intrare) and points_start_date (Points Start Date, Data de început a punctajului). All three are null on day one. Every live active Member reads the row (a Member may know the rules of their own promotion and from when their points count); no client writes it directly: set_eligibility_floor, set_membership_cutoff and set_points_start_date are the write path, one command per value, and each change is logged in promotion_threshold_changes (fields floor, cutoff, points_start).';
comment on column public.evaluation_settings.id is
  'R58: always 1 (evaluation_settings_singleton_ck) -- the table holds exactly one row.';
comment on column public.evaluation_settings.eligibility_floor is
  'R58: Eligibility Floor (Prag minim), shared by both Role Evaluation kinds -- the Task Points a Member must reach in the Evaluation Period to be ranked at all; a whole number >= 1, so a line a run computes is always a legal Promotion Threshold. Null until BC or the Moderator sets it; a Role Evaluation run or Simulation cannot start without a value.';
comment on column public.evaluation_settings.membership_cutoff is
  'R58: Membership Cutoff Date (Data limită de intrare), Voluntar Activ kind only -- a Voluntar who joined on or before this day (profiles.joined_at) can be listed as a Promotion Candidate. Null until BC or the Moderator sets it; nobody is listed as a live Promotion Candidate meanwhile and a Voluntar Activ run cannot start.';
comment on column public.evaluation_settings.points_start_date is
  'R58: Points Start Date (Data de început a punctajului) -- the first Europe/Bucharest day whose Task Points count in any total (the Personal Score, Clasament, the Department Cup, Campaign totals); earlier points stay in the ledger and count for nothing. Applied inside the SQL readers (private.points_floor), never by the client. Null until BC or the Moderator sets it: every total counts from the beginning.';
comment on column public.evaluation_settings.created_at is
  'R58: when the migration seeded the row.';
comment on column public.evaluation_settings.updated_at is
  'R58: when any of the three values last changed, stamped by evaluation_settings_set_updated_at.';
comment on column public.evaluation_settings.updated_by is
  'R58: the Member whose command last changed a value; null while the row is still as its migration seeded it.';

revoke all on table public.evaluation_settings from public, anon, authenticated, service_role;
grant select on table public.evaluation_settings to authenticated, service_role;

create policy evaluation_settings_read on public.evaluation_settings
  for select to authenticated
  using ((select public.auth_is_member()) and (select private.caller_level()) >= 0);

comment on policy evaluation_settings_read on public.evaluation_settings is
  'R58: every live active Member reads the row -- organization claims (house rule 12) plus a live activ Profile, as promotion_thresholds_read. No write policy: the three set_* commands are the write path.';

-- ---------------------------------------------------------------------------
-- 2. The change log holds dates.
-- ---------------------------------------------------------------------------
-- Three new fields: floor (a number, like a threshold), cutoff and
-- points_start (dates). A date change has no number, so to_value stops being
-- required and from_date / to_date carry the dates; date_shape_ck keeps the
-- two kinds of row apart in both directions. The `migration` source names a
-- change made by a migration (no Member, no run); `role_evaluation` keeps its
-- meaning, a run's write; no `run` value is added. The new sources and fields
-- also reach the shares: percent_shape_ck no longer demands source `manual`,
-- because the day-one change of x and y is a migration's and a finalised run
-- writes the share it used through. A run never writes the Points Start Date
-- (points_start_source_ck).
alter table public.promotion_threshold_changes
  add column from_date date,
  add column to_date date;

alter table public.promotion_threshold_changes
  alter column to_value drop not null;

alter table public.promotion_threshold_changes
  drop constraint promotion_threshold_changes_field_ck,
  drop constraint promotion_threshold_changes_percent_shape_ck,
  drop constraint promotion_threshold_changes_source_ck,
  drop constraint promotion_threshold_changes_source_shape_ck,
  drop constraint promotion_threshold_changes_subject_ck,
  drop constraint promotion_threshold_changes_to_value_range_ck;

alter table public.promotion_threshold_changes
  add constraint promotion_threshold_changes_field_ck
    check (field in ('threshold', 'percent', 'tenure', 'enabled', 'floor', 'cutoff', 'points_start')),
  add constraint promotion_threshold_changes_source_ck
    check (source in ('manual', 'role_evaluation', 'migration')),
  -- A hand edit names its author; a hand-over names its run; a migration's own
  -- change names neither.
  add constraint promotion_threshold_changes_source_shape_ck
    check ((source = 'manual' and changed_by is not null and role_evaluation_id is null)
        or (source = 'role_evaluation' and changed_by is null and role_evaluation_id is not null)
        or (source = 'migration' and changed_by is null and role_evaluation_id is null)),
  -- A threshold or share change names its kind; a rule change names its rule;
  -- a settings change belongs to neither.
  add constraint promotion_threshold_changes_subject_ck
    check ((field in ('threshold', 'percent')
            and kind is not null and promotion_rule_id is null)
        or (field in ('tenure', 'enabled')
            and kind is null and promotion_rule_id is not null)
        or (field in ('floor', 'cutoff', 'points_start')
            and kind is null and promotion_rule_id is null)),
  -- A share is a whole 1-100 both ways. Since R58 it is no longer BC's alone:
  -- a finalised run writes the share it used through to the settings
  -- (role_evaluation) and the day-one change of x and y is a migration's; the
  -- source rule that was here ("manual") is the one #866 wrote before either
  -- existed.
  add constraint promotion_threshold_changes_percent_shape_ck
    check (field <> 'percent'
           or (source in ('manual', 'migration', 'role_evaluation')
               and to_value between 1 and 100
               and (from_value is null or from_value between 1 and 100))),
  -- A run writes the Eligibility Floor, the share and the Membership Cutoff Date
  -- it used (spec section C); it never writes the Points Start Date, which only
  -- BC's command and a migration set.
  add constraint promotion_threshold_changes_points_start_source_ck
    check (field <> 'points_start' or source in ('manual', 'migration')),
  -- A threshold and a Prag minim are at least 1 Task Point (a share has its own
  -- 1-100 check, promotion_threshold_changes_percent_shape_ck; a tenure may be
  -- 0 and enabled is 0 or 1). A date row passes the first disjunct, its field
  -- being neither; a threshold or floor row with a null to_value passes the
  -- comparison too (null is not false), and date_shape_ck is what refuses it.
  add constraint promotion_threshold_changes_to_value_range_ck
    check (field not in ('threshold', 'floor') or to_value >= 1),
  -- A cutoff or points_start row carries dates and no number; every other row
  -- carries numbers and no date. A date row always names the day it moved to
  -- (from_date is null for the first value ever set).
  add constraint promotion_threshold_changes_date_shape_ck
    check ((field in ('cutoff', 'points_start')
            and to_date is not null and to_value is null and from_value is null)
        or (field not in ('cutoff', 'points_start')
            and to_value is not null and to_date is null and from_date is null));

comment on column public.promotion_threshold_changes.field is
  '#866 (ruling R30), extended by #935 and R58: which value changed. threshold (the Promotion Threshold of kind, Task Points; a hand edit or a run''s hand-over) or percent (the kind''s top share: x, the top_percent rule''s percent, for voluntar_activ; y, org_settings.vote_retention_percent, for adunarea_generala; 1-100; a hand edit, the share a finalised run wrote through, or the day-one change a migration made) name a kind; tenure (the rule''s min_tenure_months, whole months 0-120) or enabled (the rule''s on/off flag, 0 off and 1 on, always a flip) name a Promotion Rule (promotion_rule_id) and are always manual; floor (the Eligibility Floor, Prag minim: Task Points >= 1, in to_value), cutoff (the Membership Cutoff Date, Data limită de intrare) and points_start (the Points Start Date, Data de început a punctajului), the last two dates in from_date / to_date, name neither (evaluation_settings). Defaults to threshold, the only value before R30.';
comment on column public.promotion_threshold_changes.kind is
  '#826: the Role Evaluation kind whose threshold or share changed (field threshold or percent). Null for a Promotion Rule edit (field tenure or enabled, #935), which names promotion_rule_id instead, and for a settings change (field floor, cutoff or points_start, R58).';
comment on column public.promotion_threshold_changes.promotion_rule_id is
  '#935: the Promotion Rule whose tenure or on/off flag changed (field tenure or enabled); null for every other field.';
comment on column public.promotion_threshold_changes.source is
  '#826, extended by R58: manual (a Member''s command; changed_by), role_evaluation (a Role Evaluation run''s write: the threshold it handed over, or the share, Eligibility Floor or Membership Cutoff Date it used; role_evaluation_id) or migration (a change a migration made, such as the day-one change of the shares; neither). promotion_threshold_changes_source_shape_ck pairs each with what it names, and promotion_threshold_changes_points_start_source_ck keeps a run from writing the Points Start Date.';
comment on column public.promotion_threshold_changes.from_value is
  '#826: the number before (null when none was set). Null for a date field (cutoff, points_start), which uses from_date.';
comment on column public.promotion_threshold_changes.to_value is
  '#826, relaxed by R58: the number after -- a threshold, a share, a tenure, an on/off flag or a Prag minim. Null exactly for a date field (cutoff, points_start), which uses to_date (promotion_threshold_changes_date_shape_ck).';
comment on column public.promotion_threshold_changes.from_date is
  'R58: the day before, for the date fields cutoff and points_start; null when none was set, and always null for every other field.';
comment on column public.promotion_threshold_changes.to_date is
  'R58: the day after, for the date fields cutoff and points_start; always set for them and always null for every other field.';

comment on table public.promotion_threshold_changes is
  '#826 (ruling R28), extended by #866 (ruling R30), #935 and R58: every change of a Promotion Threshold, of a kind''s top share, of a Promotion Rule''s tenure or on/off flag, or of an evaluation setting. field threshold: source manual (BC or the Moderator through set_promotion_threshold; changed_by) or role_evaluation (the value a run computed, handed over; role_evaluation_id). field percent: values 1-100; source manual (set_evaluation_percent; changed_by), role_evaluation (the share a finalised run used, written through; role_evaluation_id) or migration (the day-one change of x and y). field tenure / enabled: source manual only, through update_promotion_rule, naming promotion_rule_id instead of a kind; tenure in whole months 0-120, enabled 0 (off) or 1 (on). field floor (the Eligibility Floor, Prag minim: a number >= 1 in to_value) / cutoff (the Membership Cutoff Date, Data limită de intrare) / points_start (the Points Start Date, Data de început a punctajului), the last two dates in from_date / to_date with no number: source manual through the evaluation-settings commands or migration, and for floor and cutoff also role_evaluation (a finalised run writes the values it used); a run never writes points_start. from_value / from_date is the value before (null for a threshold, a share or a setting never set; a tenure or enabled row always carries from_value). Read by live level >= 6 only; written by the commands, a finalised run and the R58 migrations.';

-- ---------------------------------------------------------------------------
-- 3. The commands that set the three values.
-- ---------------------------------------------------------------------------
-- One command per value, in the shape of set_promotion_threshold: the argument
-- is judged first (it is malformed for every caller), then the gate -- claims
-- and a live activ Profile, then live level >= 6, BC or the Moderator, every
-- refusal 42501 evaluation_settings_manage_forbidden -- then (47, 1), the lock
-- every Role Evaluation write takes, then the one row for no key update, so a
-- run that writes a value through and a hand edit are serialised. An unchanged
-- value is PT409 nothing_to_update; a changed one is written with updated_by
-- and logged once in promotion_threshold_changes, source manual. "Today" in the
-- two date checks is today in Bucharest, the organisation's calendar, whatever
-- the database clock's zone.

create function private.set_eligibility_floor_impl(p_points integer)
returns public.evaluation_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid;
  v_current public.evaluation_settings%rowtype;
  v_from    integer;
begin
  -- 1. Malformed for every caller (evaluation_settings_floor_ck).
  if p_points is null or p_points < 1 then
    raise sqlstate 'PT400' using message = 'invalid_eligibility_floor';
  end if;

  -- 2. The gate: claims and a live activ Profile, then BC or Moderator.
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'evaluation_settings_manage_forbidden';
  end;
  if coalesce(private.actor_level(v_actor), -1) < 6 then
    raise exception using errcode = '42501', message = 'evaluation_settings_manage_forbidden';
  end if;

  -- 3. Serialised with every run and threshold edit, in their lock order:
  -- (47, 1), then the row.
  perform pg_catalog.pg_advisory_xact_lock(47, 1);
  select * into v_current
    from public.evaluation_settings as setting
   where setting.id = 1
   for no key update;

  -- 4. State. Editable at any time.
  if v_current.eligibility_floor is not distinct from p_points then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;

  -- 5. Write, and audit.
  v_from := v_current.eligibility_floor;
  update public.evaluation_settings
     set eligibility_floor = p_points,
         updated_by = v_actor
   where id = 1
  returning * into v_current;

  insert into public.promotion_threshold_changes (
    field, from_value, to_value, source, changed_by
  ) values (
    'floor', v_from, p_points, 'manual', v_actor
  );

  return v_current;
end;
$$;

comment on function private.set_eligibility_floor_impl(integer) is
  'R58: body of public.set_eligibility_floor. PT400 invalid_eligibility_floor (null or below 1) before the gate; private.require_active_member() and live level >= 6, every refusal 42501 evaluation_settings_manage_forbidden; pg_advisory_xact_lock(47, 1), shared with run_role_evaluation, then the evaluation_settings row for no key update; PT409 nothing_to_update for an unchanged value. Writes eligibility_floor with updated_by and one manual promotion_threshold_changes row (field floor: from_value, to_value, changed_by).';

create function public.set_eligibility_floor(p_points integer)
returns public.evaluation_settings
language sql
security invoker
set search_path = ''
as $$
  select * from private.set_eligibility_floor_impl(p_points);
$$;

comment on function public.set_eligibility_floor(integer) is
  'R58: BC or the Moderator sets the Eligibility Floor (Prag minim) -- the Task Points a Member must reach in the Evaluation Period to be ranked at all, a whole number >= 1 -- at any time. Every change is logged in promotion_threshold_changes (field floor) with its author. 42501 evaluation_settings_manage_forbidden; PT400 invalid_eligibility_floor; PT409 nothing_to_update. Returns the evaluation_settings row.';

revoke execute on function private.set_eligibility_floor_impl(integer)
  from public, anon, authenticated, service_role;
revoke execute on function public.set_eligibility_floor(integer)
  from public, anon, authenticated, service_role;
grant execute on function private.set_eligibility_floor_impl(integer) to authenticated;
grant execute on function public.set_eligibility_floor(integer) to authenticated;

create function private.set_membership_cutoff_impl(p_date date)
returns public.evaluation_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid;
  v_current public.evaluation_settings%rowtype;
  v_from    date;
begin
  -- 1. Malformed for every caller: no date, or a day that has not begun in
  -- Bucharest.
  if p_date is null or p_date > (now() at time zone 'Europe/Bucharest')::date then
    raise sqlstate 'PT400' using message = 'invalid_membership_cutoff';
  end if;

  -- 2. The gate: claims and a live activ Profile, then BC or Moderator.
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'evaluation_settings_manage_forbidden';
  end;
  if coalesce(private.actor_level(v_actor), -1) < 6 then
    raise exception using errcode = '42501', message = 'evaluation_settings_manage_forbidden';
  end if;

  -- 3. Serialised with every run and threshold edit, in their lock order:
  -- (47, 1), then the row.
  perform pg_catalog.pg_advisory_xact_lock(47, 1);
  select * into v_current
    from public.evaluation_settings as setting
   where setting.id = 1
   for no key update;

  -- 4. State. Editable at any time.
  if v_current.membership_cutoff is not distinct from p_date then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;

  -- 5. Write, and audit.
  v_from := v_current.membership_cutoff;
  update public.evaluation_settings
     set membership_cutoff = p_date,
         updated_by = v_actor
   where id = 1
  returning * into v_current;

  insert into public.promotion_threshold_changes (
    field, from_date, to_date, source, changed_by
  ) values (
    'cutoff', v_from, p_date, 'manual', v_actor
  );

  return v_current;
end;
$$;

comment on function private.set_membership_cutoff_impl(date) is
  'R58: body of public.set_membership_cutoff. PT400 invalid_membership_cutoff (null, or after today in Europe/Bucharest) before the gate; private.require_active_member() and live level >= 6, every refusal 42501 evaluation_settings_manage_forbidden; pg_advisory_xact_lock(47, 1), shared with run_role_evaluation, then the evaluation_settings row for no key update; PT409 nothing_to_update for an unchanged date. Writes membership_cutoff with updated_by and one manual promotion_threshold_changes row (field cutoff: from_date, to_date, changed_by; no number).';

create function public.set_membership_cutoff(p_date date)
returns public.evaluation_settings
language sql
security invoker
set search_path = ''
as $$
  select * from private.set_membership_cutoff_impl(p_date);
$$;

comment on function public.set_membership_cutoff(date) is
  'R58: BC or the Moderator sets the Membership Cutoff Date (Data limită de intrare) -- a Voluntar who joined on or before it can be listed as a Promotion Candidate in the Voluntar Activ kind -- to a day that is not after today in Bucharest, at any time. Every change is logged in promotion_threshold_changes (field cutoff) with its author. 42501 evaluation_settings_manage_forbidden; PT400 invalid_membership_cutoff; PT409 nothing_to_update. Returns the evaluation_settings row.';

revoke execute on function private.set_membership_cutoff_impl(date)
  from public, anon, authenticated, service_role;
revoke execute on function public.set_membership_cutoff(date)
  from public, anon, authenticated, service_role;
grant execute on function private.set_membership_cutoff_impl(date) to authenticated;
grant execute on function public.set_membership_cutoff(date) to authenticated;

create function private.set_points_start_date_impl(p_date date)
returns public.evaluation_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid;
  v_current public.evaluation_settings%rowtype;
  v_from    date;
begin
  -- 1. Malformed for every caller: no date, or a day that has not begun in
  -- Bucharest.
  if p_date is null or p_date > (now() at time zone 'Europe/Bucharest')::date then
    raise sqlstate 'PT400' using message = 'invalid_points_start_date';
  end if;

  -- 2. The gate: claims and a live activ Profile, then BC or Moderator.
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'evaluation_settings_manage_forbidden';
  end;
  if coalesce(private.actor_level(v_actor), -1) < 6 then
    raise exception using errcode = '42501', message = 'evaluation_settings_manage_forbidden';
  end if;

  -- 3. Serialised with every run and threshold edit, in their lock order:
  -- (47, 1), then the row.
  perform pg_catalog.pg_advisory_xact_lock(47, 1);
  select * into v_current
    from public.evaluation_settings as setting
   where setting.id = 1
   for no key update;

  -- 4. State. Editable at any time.
  if v_current.points_start_date is not distinct from p_date then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;

  -- 5. Write, and audit.
  v_from := v_current.points_start_date;
  update public.evaluation_settings
     set points_start_date = p_date,
         updated_by = v_actor
   where id = 1
  returning * into v_current;

  insert into public.promotion_threshold_changes (
    field, from_date, to_date, source, changed_by
  ) values (
    'points_start', v_from, p_date, 'manual', v_actor
  );

  return v_current;
end;
$$;

comment on function private.set_points_start_date_impl(date) is
  'R58: body of public.set_points_start_date. PT400 invalid_points_start_date (null, or after today in Europe/Bucharest) before the gate; private.require_active_member() and live level >= 6, every refusal 42501 evaluation_settings_manage_forbidden; pg_advisory_xact_lock(47, 1), shared with run_role_evaluation, then the evaluation_settings row for no key update; PT409 nothing_to_update for an unchanged date. Writes points_start_date with updated_by and one manual promotion_threshold_changes row (field points_start: from_date, to_date, changed_by; no number).';

create function public.set_points_start_date(p_date date)
returns public.evaluation_settings
language sql
security invoker
set search_path = ''
as $$
  select * from private.set_points_start_date_impl(p_date);
$$;

comment on function public.set_points_start_date(date) is
  'R58: BC or the Moderator sets the Points Start Date (Data de început a punctajului) -- the first Europe/Bucharest day whose Task Points count in any total; earlier points stay in the ledger and count for nothing -- to a day that is not after today in Bucharest, at any time, earlier or later than the one in force. Every change is logged in promotion_threshold_changes (field points_start) with its author; a Role Evaluation run never writes it. 42501 evaluation_settings_manage_forbidden; PT400 invalid_points_start_date; PT409 nothing_to_update. Returns the evaluation_settings row.';

revoke execute on function private.set_points_start_date_impl(date)
  from public, anon, authenticated, service_role;
revoke execute on function public.set_points_start_date(date)
  from public, anon, authenticated, service_role;
grant execute on function private.set_points_start_date_impl(date) to authenticated;
grant execute on function public.set_points_start_date(date) to authenticated;

-- The instant the Points Start Date begins: its Bucharest midnight, or null
-- while no date is set (every total then counts from the beginning). The
-- SQL readers of the Personal Score, Clasament, the Department Cup and the
-- Campaign totals compare the time points were earned against it, so the zone
-- is applied once, here, never by a client and never by the session's own zone.
create function private.points_floor()
returns timestamptz
language sql
stable
security invoker
set search_path = ''
as $$
  select (setting.points_start_date::timestamp at time zone 'Europe/Bucharest')
    from public.evaluation_settings as setting
   where setting.id = 1
$$;

comment on function private.points_floor() is
  'R58: the instant the Points Start Date begins -- points_start_date at midnight in Europe/Bucharest, independent of the session time zone -- or null while no date is set, when every total counts from the beginning. Read by the SQL readers of the Personal Score, Clasament, the Department Cup and the Campaign totals, which count only the Task Points earned at or after it; granted to nobody, since only security-definer bodies call it.';

revoke execute on function private.points_floor()
  from public, anon, authenticated, service_role;
